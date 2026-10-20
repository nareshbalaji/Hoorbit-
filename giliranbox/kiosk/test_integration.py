"""Runs the kiosk core against the REAL Postgres functions (JSON contract check). Skips if the test DB is absent.
Prepare with: supabase/tests/run.sh  (leaves database `gb` loaded with migrations + seed)."""
import json
import subprocess
import unittest

from kiosk_core import ApiError, Kiosk, Store

SHOP = "10000000-0000-4000-8000-000000000001"
STAFF = "00000000-0000-4000-8000-000000000004"


def psql(sql):
    r = subprocess.run(["su", "postgres", "-c", "psql -X -q -t -A -d gb -v ON_ERROR_STOP=1"], input=sql, capture_output=True, text=True)
    if r.returncode:
        raise ApiError(r.stderr.strip().split("ERROR:")[-1].strip())
    return r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ""


def lit(v):
    if v is None:
        return "null"
    if isinstance(v, (dict, list)):
        return "'" + json.dumps(v).replace("'", "''") + "'::jsonb"
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def api(fn, params):
    args = ", ".join(f"{k} => {lit(v)}" for k, v in params.items())
    out = psql(f"set role anon; select to_json({fn}({args}));")
    return json.loads(out) if out else None


def db_up():
    try:
        psql("select 1 from shops limit 1")
        return True
    except Exception:
        return False


@unittest.skipUnless(db_up(), "test database `gb` not available")
class RealDb(unittest.TestCase):
    def test_full_cycle(self):
        psql("delete from queue_tickets; delete from queue_counters; delete from kiosk_devices; delete from kiosk_pairings;")
        k = Kiosk(Store(), api)
        code = k.pairing_step()
        self.assertEqual(len(code), 10)
        psql(f"set role authenticated; select set_config('request.jwt.claim.sub','{STAFF}',false); select kiosk_pair_claim('{code}','{SHOP}','Front kiosk');")
        self.assertIsNone(k.pairing_step())
        self.assertTrue(k.paired)

        a = k.create_ticket("walk-in 1")
        b = k.create_ticket("walk-in 2")
        self.assertEqual((a["number"], b["number"]), (1, 2))
        self.assertEqual(psql("select last_number from queue_counters"), "100")   # block reserved on the server

        self.assertTrue(k.sync())
        self.assertEqual(psql("select count(*) from queue_tickets where source='kiosk'"), "2")
        self.assertTrue(k.sync())                                                   # replay is idempotent
        self.assertEqual(psql("select count(*) from queue_tickets where source='kiosk'"), "2")

        # an app customer joins -> numbered AFTER the block
        psql(f"set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false); select join_queue('{SHOP}');")
        self.assertEqual(psql("select number from queue_tickets where source='app'"), "101")

        self.assertEqual(k.call_next(), 1)                                          # server-authoritative NEXT
        self.assertEqual(k.call_next(), 2)
        self.assertEqual(k.call_next(), 101)                                        # then the app customer
        self.assertIsNone(k.call_next())                                            # nobody waiting -> all-null row handled
        snap = api("kiosk_snapshot", {"p_token": k.token})
        self.assertEqual(snap["waiting"], 0)


if __name__ == "__main__":
    unittest.main()
