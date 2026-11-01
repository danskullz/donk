"""Drive a running CS2 (launched with -netconport) through a list of camera poses and capture each one.

Phase 0 capture spike. Per shot: teleport + aim over the console port, wait for the frame to settle,
then grab the screen with capture_screen.ps1 (which refuses to capture unless CS2 is the foreground
window). Positions are Valve's retake positions; on Mirage they are eye positions, so the player
origin is set 64 units lower.

usage: python -I capture_run.py <port> <password> <manifest.json> <out_dir> <powershell.exe>
"""
import json
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from netcon import connect, drain  # noqa: E402

EYE_HEIGHT = 64.0
SETTLE = 1.4  # seconds between teleport and capture


def say(sock, cmd, wait=0.25):
    sock.sendall((cmd + "\n").encode())
    return drain(sock, wait).strip()


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def main(port, password, manifest_path, out_dir, powershell):
    with open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)
    os.makedirs(out_dir, exist_ok=True)
    here = os.path.dirname(os.path.abspath(__file__))
    ps1 = os.path.join(here, "capture_screen.ps1")

    sock = connect(port, password)
    drain(sock, 0.8)
    for cmd in ("sv_cheats 1", "bot_kick", "mp_freezetime 0", "noclip 1"):
        say(sock, cmd)
    time.sleep(1.0)

    results = []
    for shot in manifest["shots"]:
        pose = shot["pose"]
        note = shot["note"]
        # experiment shots toggle the HUD / viewmodel; the rest keep both hidden
        if note.startswith("baseline"):
            say(sock, "cl_drawhud 1"); say(sock, "r_drawviewmodel 1")
        elif note == "cl_drawhud 0":
            say(sock, "cl_drawhud 0")
        else:
            say(sock, "cl_drawhud 0"); say(sock, "r_drawviewmodel 0")
        say(sock, "setpos_exact %.3f %.3f %.3f" % (pose["x"], pose["y"], pose["z"] - EYE_HEIGHT))
        say(sock, "setang_exact %.3f %.3f 0" % (pose["pitch"], pose["yaw"]))
        time.sleep(SETTLE)
        name = "shot_%02d_%s.png" % (shot["n"], slug(pose["title"] if note.startswith("retake") else note))
        out = os.path.join(out_dir, name)
        t0 = time.time()
        proc = subprocess.run(
            [powershell, "-NoProfile", "-File", ps1, "-Out", out],
            capture_output=True, text=True, timeout=60)
        status = (proc.stdout or proc.stderr).strip().splitlines()[-1] if (proc.stdout or proc.stderr).strip() else "no output"
        ok = proc.returncode == 0 and os.path.exists(out)
        results.append({"n": shot["n"], "file": name if ok else None, "status": status, "seconds": round(time.time() - t0, 1)})
        print("%2d  %-40s %s (%.1fs)" % (shot["n"], name, status, time.time() - t0))
        if proc.returncode == 2:
            print("CS2 is not the foreground window; stopping so nothing else is captured.")
            break

    say(sock, "cl_drawhud 1"); say(sock, "r_drawviewmodel 1")  # leave the game as we found it
    sock.close()
    with open(os.path.join(out_dir, "results.json"), "w", encoding="utf-8") as f:
        json.dump({"manifest": manifest["map"], "results": results}, f, indent=2)


if __name__ == "__main__":
    main(int(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
