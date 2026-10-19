"""GiliranBox Raspberry Pi kiosk core: pairing, offline-first ticketing, sync.

Design (see docs/KIOSK.md):
  * Pair once via QR: the Pi shows `giliranbox://pair?code=XXXX`; staff scans it in the app; the Pi then receives a
    device token exactly once and stores it.
  * Offline-first: while online the kiosk RESERVES a block of ticket numbers from the server. Tickets are issued from
    that block with no connection, stored in SQLite, and replayed to the server (idempotent by client_id) when the
    link returns. App tickets are numbered after the block, so numbers never collide.
  * Network is injected as `api(fn, params)` so the logic is testable without a server.
"""
import json
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta, timezone

KL = timezone(timedelta(hours=8))  # Malaysia: fixed UTC+8, no DST


class OfflineError(Exception):
    pass


class ApiError(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.message = message


class NoNumbers(Exception):
    """Reserved block exhausted while offline: ask the customer to see staff."""


def kl_today(now=None):
    return (now or datetime.now(KL)).astimezone(KL).date().isoformat()


class Store:
    def __init__(self, path=":memory:"):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.lock = threading.RLock()
        with self.lock:
            self.db.executescript("""
                create table if not exists kv (k text primary key, v text);
                create table if not exists blocks (day text, first int, last int, next int);
                create table if not exists tickets (
                  client_id text primary key, day text, number int, label text, status text,
                  created_at text, called_at text, done_at text, dirty int default 1);
            """)

    def get(self, k, default=None):
        with self.lock:
            r = self.db.execute("select v from kv where k=?", (k,)).fetchone()
            return json.loads(r[0]) if r else default

    def put(self, k, v):
        with self.lock:
            self.db.execute("insert into kv values (?,?) on conflict(k) do update set v=excluded.v", (k, json.dumps(v)))
            self.db.commit()


class Kiosk:
    BLOCK_SIZE = 100
    REFILL_BELOW = 30

    def __init__(self, store, api, now=None):
        self.s = store
        self.api = api
        self.now = now or (lambda: datetime.now(KL))
        self.online = True

    # ---- plumbing -------------------------------------------------------------------------------------------
    def _call(self, fn, **params):
        try:
            r = self.api(fn, params)
            self.online = True
            return r
        except OfflineError:
            self.online = False
            raise

    @property
    def token(self):
        return self.s.get("token")

    @property
    def paired(self):
        return self.token is not None

    # ---- pairing --------------------------------------------------------------------------------------------
    def pairing_step(self):
        """Call every few seconds while unpaired. Returns the code to display as QR, or None once paired."""
        if self.paired:
            return None
        code = self.s.get("pair_code")
        if not code:
            code = self._call("kiosk_pair_start")
            self.s.put("pair_code", code)
            return code
        r = self._call("kiosk_pair_poll", p_code=code)
        if r["status"] == "paired":
            self.s.put("token", r["token"])
            self.s.put("shop_id", r["shop_id"])
            self.s.put("pair_code", None)
            return None
        if r["status"] == "expired":
            self.s.put("pair_code", None)  # next call starts a fresh pairing
        return self.s.get("pair_code")

    # ---- numbers --------------------------------------------------------------------------------------------
    def _remaining(self, day):
        with self.s.lock:
            r = self.s.db.execute("select coalesce(sum(last - next + 1), 0) from blocks where day=? and next <= last", (day,)).fetchone()
        return r[0]

    def refill(self):
        """Reserve a fresh block of numbers from the server (needs a connection)."""
        day = kl_today(self.now())
        b = self._call("kiosk_reserve_block", p_token=self.token, p_size=self.BLOCK_SIZE)
        with self.s.lock:
            self.s.db.execute("insert into blocks values (?,?,?,?)", (b["day"], b["first"], b["last"], b["first"]))
            self.s.db.commit()
        return b

    def _take_number(self, day):
        with self.s.lock:
            r = self.s.db.execute("select rowid, next from blocks where day=? and next <= last order by first limit 1", (day,)).fetchone()
            if not r:
                return None
            self.s.db.execute("update blocks set next = next + 1 where rowid=?", (r[0],))
            self.s.db.commit()
            return r[1]

    def create_ticket(self, label=None):
        day = kl_today(self.now())
        if self._remaining(day) < self.REFILL_BELOW:
            try:
                self.refill()
            except (OfflineError, ApiError):
                pass  # keep issuing from what we have
        n = self._take_number(day)
        if n is None:
            raise NoNumbers()
        t = dict(client_id=str(uuid.uuid4()), day=day, number=n, label=label, status="waiting",
                 created_at=self.now().isoformat(), called_at=None, done_at=None)
        with self.s.lock:
            self.s.db.execute("insert into tickets (client_id,day,number,label,status,created_at) values (?,?,?,?,?,?)",
                              (t["client_id"], day, n, label, "waiting", t["created_at"]))
            self.s.db.commit()
        return t

    # ---- counter actions (local, work offline) --------------------------------------------------------------
    def _local_waiting(self, day):
        with self.s.lock:
            return self.s.db.execute("select client_id, number from tickets where day=? and status='waiting' order by number", (day,)).fetchall()

    def call_next(self):
        """Online: the server is authoritative (it also knows about app tickets). Offline: serve local tickets."""
        day = kl_today(self.now())
        ts = self.now().isoformat()
        try:
            r = self._call("kiosk_call_next", p_token=self.token)
            num = (r or {}).get("number")   # PostgREST returns an all-null row when nobody is waiting
            with self.s.lock:  # mirror the server result locally (not dirty: the server already knows)
                self.s.db.execute("update tickets set status='done', done_at=?, dirty=0 where day=? and status='called' and number <> ?", (ts, day, num if num is not None else -1))
                if num is not None:
                    self.s.db.execute("update tickets set status='called', called_at=?, dirty=0 where day=? and number=?", (ts, day, num))
                self.s.db.commit()
            self.s.put("serving", num)
            return num
        except OfflineError:
            pass
        with self.s.lock:
            self.s.db.execute("update tickets set status='done', done_at=?, dirty=1 where day=? and status='called'", (ts, day))
            w = self._local_waiting(day)
            if not w:
                self.s.db.commit()
                self.s.put("serving", None)
                return None
            self.s.db.execute("update tickets set status='called', called_at=?, dirty=1 where client_id=?", (ts, w[0][0]))
            self.s.db.commit()
        self.s.put("serving", w[0][1])
        return w[0][1]

    def recall(self):
        try:
            self._call("kiosk_recall", p_token=self.token)
        except OfflineError:
            pass
        return self.s.get("serving")

    # ---- sync -----------------------------------------------------------------------------------------------
    def sync(self):
        """Replay dirty tickets (idempotent by client_id), refresh the server snapshot. Safe to call repeatedly."""
        if not self.paired:
            return False
        try:
            with self.s.lock:
                rows = self.s.db.execute("select client_id,day,number,label,status,created_at,called_at,done_at from tickets where dirty=1").fetchall()
            if rows:
                payload = [dict(zip(("client_id", "day", "number", "label", "status", "created_at", "called_at", "done_at"), r)) for r in rows]
                self._call("kiosk_sync", p_token=self.token, p_tickets=payload)
                with self.s.lock:
                    self.s.db.executemany("update tickets set dirty=0 where client_id=?", [(r[0],) for r in rows])
                    self.s.db.commit()
            snap = self._call("kiosk_snapshot", p_token=self.token)
            self.s.put("snapshot", snap)
            if self._remaining(kl_today(self.now())) < self.REFILL_BELOW:
                self.refill()
            return True
        except OfflineError:
            return False
        except ApiError as e:
            if "bad_kiosk_token" in e.message:   # revoked in the app: forget the token and re-pair
                self.s.put("token", None)
            return False

    def state(self):
        day = kl_today(self.now())
        snap = self.s.get("snapshot") or {}
        with self.s.lock:
            recent = [r[0] for r in self.s.db.execute("select number from tickets where day=? and called_at is not null order by called_at desc limit 5", (day,))]
            waiting_local = len(self._local_waiting(day))
        # Online: the server snapshot is the truth (staff may have pressed NEXT on a phone). Offline: local counter state.
        serving = snap.get("serving") if (self.online and snap) else self.s.get("serving")
        return {"paired": self.paired, "pair_code": self.s.get("pair_code"), "online": self.online,
                "serving": serving, "waiting": snap.get("waiting", waiting_local) if self.online else waiting_local,
                "recent": recent, "numbers_left": self._remaining(day), "day": day}
