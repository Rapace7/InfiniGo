# -*- coding: utf-8 -*-
"""启动 RapaceGo（带 CDP 调试口）→ 跑测试脚本 → 截图（可跑第二段并截第二张）→ 关闭

用法：python _rtest.py [测试脚本] [截图名] [第二段脚本] [第二张截图名]
全程只管理自己启动的 electron 进程，绝不碰用户已开着的实例。
"""
import subprocess, time, os, ctypes, sys
from ctypes import wintypes
from PIL import Image

# ★ 项目目录**从本文件位置推导**，不写死盘符 ——
#   否则把文件夹改名（GoMate → RapaceGo）后整套测试脚本就全废了。
APP = os.path.dirname(os.path.abspath(__file__))
EXE = os.path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe')
NODE = r'C:\Users\rapac\.workbuddy\binaries\node\versions\22.22.2-3\node.exe'
G = APP + os.sep
S1 = sys.argv[1] if len(sys.argv) > 1 else G + '_cdp_test.mjs'
P1 = sys.argv[2] if len(sys.argv) > 2 else G + '_rule.png'
S2 = sys.argv[3] if len(sys.argv) > 3 else None
P2 = sys.argv[4] if len(sys.argv) > 4 else G + '_panel2.png'

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32


class BIH(ctypes.Structure):
    _fields_ = [("biSize", ctypes.c_uint32), ("biWidth", ctypes.c_int32), ("biHeight", ctypes.c_int32),
                ("biPlanes", ctypes.c_uint16), ("biBitCount", ctypes.c_uint16), ("biCompression", ctypes.c_uint32),
                ("biSizeImage", ctypes.c_uint32), ("biXPelsPerMeter", ctypes.c_int32),
                ("biYPelsPerMeter", ctypes.c_int32), ("biClrUsed", ctypes.c_uint32),
                ("biClrImportant", ctypes.c_uint32)]


def capture(hwnd, out):
    r = wintypes.RECT(); user32.GetWindowRect(hwnd, ctypes.byref(r))
    w, h = r.right - r.left, r.bottom - r.top
    hdc = user32.GetWindowDC(hwnd); mfc = gdi32.CreateCompatibleDC(hdc)
    bmp = gdi32.CreateCompatibleBitmap(hdc, w, h)
    gdi32.SelectObject(mfc, bmp); user32.PrintWindow(hwnd, mfc, 2)
    bmi = BIH(); bmi.biSize = ctypes.sizeof(BIH); bmi.biWidth = w; bmi.biHeight = -h
    bmi.biPlanes = 1; bmi.biBitCount = 32
    buf = ctypes.create_string_buffer(w * h * 4)
    gdi32.GetDIBits(mfc, bmp, 0, h, buf, ctypes.byref(bmi), 0)
    Image.frombuffer('RGBA', (w, h), buf, 'raw', 'BGRA', 0, 1).convert('RGB').save(out)
    gdi32.DeleteObject(bmp); gdi32.DeleteDC(mfc); user32.ReleaseDC(hwnd, hdc)
    return (w, h)


def electron_pids():
    out = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq electron.exe', '/FO', 'CSV', '/NH'],
                         capture_output=True, text=True, errors='ignore').stdout
    pids = set()
    for ln in out.splitlines():
        p = [x.strip().strip('"') for x in ln.split(',')]
        if p and p[0].lower() == 'electron.exe':
            try:
                pids.add(int(p[1]))
            except ValueError:
                pass
    return pids


def my_window(pid):
    found = []
    CB = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

    def cb(h, l):
        p = wintypes.DWORD()
        user32.GetWindowThreadProcessId(h, ctypes.byref(p))
        if p.value != pid or not user32.IsWindowVisible(h):
            return True
        n = user32.GetWindowTextLengthW(h)
        b = ctypes.create_unicode_buffer(n + 1)
        user32.GetWindowTextW(h, b, n + 1)
        # ⚠️ 窗口标题跟着应用名字走 —— 改过两次名（对弈学习器 → 玄清围奕 → 玄清围弈），
        #    第一次改名时只改了两处标题的匹配字符串，这里漏了，导致截图整段失败
        #    （报「没找到自己的窗口」）。所以历次名字都留着匹配。
        if any(t in b.value for t in ('围弈', '围奕', '对弈')):
            found.append(h)
        return True

    user32.EnumWindows(CB(cb), 0)
    return found[0] if found else None


def kill_my_leftovers():
    """清掉「属于 GoMate 的」残留 electron（只按命令行筛，不碰别的 electron 应用）。
    为什么必须清：调试端口 9333 只有一个，残留实例占着的话，
    新实例绑不上端口，测试脚本会连到**旧实例**上 —— 拿到旧页面、旧代码，
    报出来的错完全对不上号（踩过：新加的下拉「不存在」）。"""
    ps = ("Get-CimInstance Win32_Process -Filter \"name='electron.exe'\" | "
          "Where-Object { $_.CommandLine -like '*GoMate*' } | "
          "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }")
    subprocess.run(['powershell', '-NoProfile', '-Command', ps], capture_output=True)
    time.sleep(2)


def port_busy(port=9333):
    import socket
    s = socket.socket()
    try:
        s.settimeout(0.4)
        s.connect(('127.0.0.1', port))
        return True
    except Exception:
        return False
    finally:
        s.close()


before = electron_pids()
if port_busy():
    print('调试端口 9333 被占用 —— 清理残留的 GoMate 实例（否则测试会连到旧实例）', flush=True)
    kill_my_leftovers()
env = dict(os.environ)
env.pop('ELECTRON_RUN_AS_NODE', None)
os.makedirs(G + '_trash', exist_ok=True)          # 运行日志也丢进 _trash，根目录保持干净
lf = open(G + '_trash/_run.log', 'w', encoding='utf-8')
proc = subprocess.Popen([EXE, '--remote-debugging-port=9333', APP], env=env,
                        stdout=lf, stderr=subprocess.STDOUT)
print('已启动 pid=%d（此前已有 electron: %s）' % (proc.pid, sorted(before)), flush=True)
time.sleep(11)

if proc.poll() is not None:
    print('FAIL: 进程退出 code=%s' % proc.returncode)
    print(open(G + '_trash/_run.log', encoding='utf-8', errors='ignore').read()[:1200])
    sys.exit(1)


def run_node(script, tag):
    print('--- %s: %s ---' % (tag, os.path.basename(script)), flush=True)
    r = subprocess.run([NODE, script], capture_output=True, text=True,
                       encoding='utf-8', errors='ignore', timeout=420)
    print(r.stdout or '(无输出)')
    if r.stderr:
        print('[stderr]', r.stderr[:600])


run_node(S1, '测试')

hwnd = my_window(proc.pid)
if not hwnd:
    print('FAIL: 没找到自己的窗口')
    sys.exit(1)
user32.SetWindowPos(hwnd, 0, 620, 90, 1240, 880, 0x0004)
time.sleep(1.2)
print('截图1:', capture(hwnd, P1))

if S2:
    run_node(S2, '第二段')
    time.sleep(1.0)
    print('截图2:', capture(hwnd, P2))

import os as _os
if _os.environ.get('GOMATE_KEEP') == '1':
    print('GOMATE_KEEP=1 → 保留窗口不关闭（用户要看界面）')
else:
    subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'], capture_output=True)
    print('已关闭自己的实例')
