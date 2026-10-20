# Raspberry Pi queue kiosk

Hardware: any Pi with network, an HDMI TV, a USB/serial **ESC/POS thermal printer**, an optional GPIO push-button.
Software: Python 3.9+ (stdlib only; `segno` optional for the pairing QR on the TV).

## Install
```bash
sudo mkdir -p /opt/giliranbox-kiosk /var/lib/giliranbox && sudo cp kiosk/*.py kiosk/config.example.json /opt/giliranbox-kiosk/
cd /opt/giliranbox-kiosk && sudo cp config.example.json config.json && sudo nano config.json   # url, anon key, shop name, pin, printer
pip3 install segno            # optional (QR on TV)
sudo cp giliranbox-kiosk.service /etc/systemd/system/ && sudo systemctl enable --now giliranbox-kiosk
chromium-browser --kiosk http://localhost:8080/tv        # on the TV
```

## Pair via QR
1. Start the kiosk unpaired → the TV shows a QR (`giliranbox://pair?code=…`) and the code.
2. Shop staff scans it with the phone camera → the GiliranBox app opens the **Counter** screen and claims the code for their shop (or Account → Counter → QR icon → type the code).
3. The Pi receives its device token **once** and stores it. Revoke with SQL / REST (`update kiosk_devices set revoked = true`; staff can do this through RLS) → the Pi's next call fails with `bad_kiosk_token` and it falls back to pairing. (There is no revoke button in the app yet.)

## Using it
* **Customers** press the GPIO button (or the shop taps `+ Walk-in ticket` on `http://<pi>:8080/counter?pin=…`) → a ticket prints with number, people waiting, time.
* **TV** `/tv`: big "NOW SERVING" number with a chime when it changes, last 5 called, OFFLINE badge.
* **Calling**: staff use the phone Counter screen (NEXT / RECALL / SKIP) *or* the Pi's own `/counter` page. App customers get a push "your turn"; the TV follows the server within ~5 s (Pi syncs every 3 s, TV refreshes every 2 s).

## Offline behaviour (internet drops)
| Situation | Behaviour |
|---|---|
| Online | Kiosk keeps ≥ 30 numbers in a reserved block (`kiosk_reserve_block`, 100 at a time). |
| Offline | Tickets keep printing from the reserved block, stored in local SQLite (`dirty=1`). NEXT/RECALL work on local tickets from `/counter`. TV keeps working (local LAN). |
| Reconnect | `kiosk_sync` replays tickets/status idempotently by `client_id`; exponential back-off (5 s → 60 s) while down. |
| Block exhausted offline | Printing refuses with "see staff" (`HTTP 409`) rather than risk duplicate numbers. |
| Numbers | App tickets are numbered after every reserved block, so kiosk and app numbers never collide. Order is by number, so a customer who joined by app *during* an outage queues behind the walk-ins issued from the block. |

**Known limitation:** while the Pi is offline, tickets taken in the app (not on the Pi) are invisible to the Pi's local NEXT; call those from a phone Counter screen, or wait for reconnection. Calls made on the server while the Pi is offline are mirrored the next time the Pi calls NEXT online.

## Tests
`cd kiosk && python3 -m unittest test_kiosk test_integration` — 9 unit tests with a fake server (pairing, offline issue, idempotent replay, block exhaustion, revoked token) and 1 end-to-end test against the real Postgres functions (JSON contract, number ranges, NEXT order).
