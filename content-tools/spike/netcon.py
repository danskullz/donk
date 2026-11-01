"""Send console commands to a running CS2 over its local TCP console (-netconport) and print the replies.

Phase 0 capture spike. A startup config cannot sequence "load map, wait, teleport, screenshot"
(the engine runs every line at once), so commands are sent from here with real delays.

usage: python -I netcon.py <port> <password> <script>
  script lines:  <console command>   |   sleep <seconds>   |   # comment
Replies are collected for 0.4 s after each command (longer after 'find' / 'status').
"""
import socket
import sys
import time


def drain(sock, wait):
    sock.settimeout(0.1)
    end = time.time() + wait
    chunks = []
    while time.time() < end:
        try:
            data = sock.recv(65536)
            if not data:
                break
            chunks.append(data)
            end = max(end, time.time() + 0.15)
        except socket.timeout:
            continue
        except OSError:
            break
    return b"".join(chunks).decode("utf-8", "replace")


def connect(port, password, tries=60):
    last = None
    for _ in range(tries):
        try:
            s = socket.create_connection(("127.0.0.1", port), timeout=3)
            s.sendall(("PASS %s\n" % password).encode())
            return s
        except OSError as exc:
            last = exc
            time.sleep(2)
    raise SystemExit("could not connect to 127.0.0.1:%d (%s)" % (port, last))


def main(port, password, script):
    sock = connect(port, password)
    print("[connected]", drain(sock, 1.0).strip()[:300])
    with open(script, encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("sleep "):
                time.sleep(float(line.split()[1]))
                continue
            sock.sendall((line + "\n").encode())
            slow = line.startswith(("find", "status", "cvarlist", "help"))
            reply = drain(sock, 1.5 if slow else 0.4).strip()
            print(">>", line)
            if reply:
                for out in reply.splitlines()[:40]:
                    print("   ", out[:200])
    sock.close()


if __name__ == "__main__":
    main(int(sys.argv[1]), sys.argv[2], sys.argv[3])
