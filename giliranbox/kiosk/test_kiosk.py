import unittest
from datetime import datetime
from kiosk_core import ApiError, Kiosk, KL, NoNumbers, OfflineError, Store


class FakeServer:
    """Stand-in for the Supabase RPCs, with a switch for losing the connection."""
    def __init__(self):
        self.up = True
        self.counter = 0
        self.tickets = {}      # client_id -> dict
        self.claimed = False
        self.calls = []
        self.serving = None

    def __call__(self, fn, p):
        if not self.up:
            raise OfflineError()
        self.calls.append(fn)
        day = datetime.now(KL).date().isoformat()
        if fn == "kiosk_pair_start":
            return "ABCDE12345"
        if fn == "kiosk_pair_poll":
            return {"status": "paired", "token": "t" * 64, "shop_id": "shop-1"} if self.claimed else {"status": "waiting"}
        if p.get("p_token") not in (None, "t" * 64):
            raise ApiError("bad_kiosk_token")
        if fn == "kiosk_reserve_block":
            first = self.counter + 1
            self.counter += p["p_size"]
            return {"first": first, "last": self.counter, "day": day}
        if fn == "kiosk_sync":
            for t in p["p_tickets"]:
                self.tickets[t["client_id"]] = t   # upsert by client_id => idempotent
            return {"synced": len(p["p_tickets"])}
        if fn == "kiosk_snapshot":
            return {"serving": self.serving, "waiting": sum(1 for t in self.tickets.values() if t["status"] == "waiting")}
        if fn == "kiosk_call_next":
            return None
        if fn == "kiosk_recall":
            return None
        raise AssertionError(fn)


def make():
    srv = FakeServer()
    k = Kiosk(Store(), srv)
    return srv, k


def paired():
    srv, k = make()
    assert k.pairing_step() == "ABCDE12345"      # starts pairing, shows QR code
    assert k.pairing_step() == "ABCDE12345"      # still waiting for staff
    srv.claimed = True
    assert k.pairing_step() is None              # token received once
    assert k.paired
    return srv, k


class KioskTests(unittest.TestCase):
    def test_pairing_flow(self):
        srv, k = paired()
        self.assertEqual(k.token, "t" * 64)

    def test_tickets_from_reserved_block_work_offline(self):
        srv, k = paired()
        k.create_ticket("A")                       # online: triggers block reservation (first number 1)
        srv.up = False
        nums = [k.create_ticket(f"w{i}")["number"] for i in range(5)]
        self.assertEqual(nums, [2, 3, 4, 5, 6])    # no connection needed
        self.assertFalse(k.sync())                 # offline: nothing lost, returns False
        self.assertEqual(len(srv.tickets), 0)

    def test_sync_after_reconnect_is_idempotent(self):
        srv, k = paired()
        srv.up = False
        k.online = False
        srv.up = True
        k.create_ticket()
        srv.up = False
        k.create_ticket()
        k.create_ticket()
        srv.up = True
        self.assertTrue(k.sync())
        self.assertEqual(len(srv.tickets), 3)
        self.assertTrue(k.sync())                  # replay: nothing duplicated
        self.assertEqual(len(srv.tickets), 3)

    def test_app_tickets_never_collide_with_block(self):
        srv, k = paired()
        k.create_ticket()
        self.assertEqual(srv.counter, 100)         # server counter advanced past the whole reserved block
        k.refill()                                 # a later block starts after it: ranges never overlap
        self.assertEqual(srv.counter, 200)
        self.assertEqual(k.s.db.execute("select first from blocks order by first").fetchall(), [(1,), (101,)])

    def test_offline_counter_calls_local_tickets_in_order_and_syncs_status(self):
        srv, k = paired()
        for _ in range(3):
            k.create_ticket()
        k.sync()
        srv.up = False
        self.assertEqual(k.call_next(), 1)
        self.assertEqual(k.call_next(), 2)
        self.assertEqual(k.state()["serving"], 2)
        srv.up = True
        k.sync()
        by_num = {t["number"]: t["status"] for t in srv.tickets.values()}
        self.assertEqual(by_num, {1: "done", 2: "called", 3: "waiting"})

    def test_block_exhausted_offline_raises(self):
        srv, k = paired()
        k.BLOCK_SIZE = 2
        k.create_ticket()
        srv.up = False
        k.create_ticket()
        with self.assertRaises(NoNumbers):
            k.create_ticket()

    def test_revoked_token_forces_repair(self):
        srv, k = paired()
        k.s.put("token", "x" * 64)                 # server now rejects this token
        k.sync()
        self.assertFalse(k.paired)

    def test_tv_follows_server_when_staff_call_from_phone(self):
        srv, k = paired()
        k.create_ticket()
        srv.serving = 7                         # staff pressed NEXT in the phone app
        k.sync()
        self.assertEqual(k.state()["serving"], 7)
        srv.up = False
        k.sync()                                # link lost: falls back to local counter state
        self.assertFalse(k.online)
        self.assertIsNone(k.state()["serving"])

    def test_state_shape(self):
        srv, k = paired()
        k.create_ticket()
        s = k.state()
        self.assertTrue(s["paired"] and s["numbers_left"] == 99 and s["day"])


if __name__ == "__main__":
    unittest.main()
