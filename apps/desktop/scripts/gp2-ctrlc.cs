// gp2-ctrlc.exe <pid> — sends a Ctrl+C event to the console of another process.
//
// Why this exists: Node/Electron's `child.kill()` on Windows is always an
// abrupt TerminateProcess. For `gphoto2 --capture-movie` that leaves the
// camera's PTP session (and live view) open with no close handshake, and a
// Sony A7 III stops answering PTP altogether after a handful of those kills
// (reproduced on real hardware 2026-09-30: 6 start+hard-kill cycles, then
// every later gphoto2 call — even `--summary` — times out until the USB
// cable is physically replugged). gphoto2 traps SIGINT and shuts the
// session down cleanly, so delivering a real Ctrl+C is the graceful stop.
//
// How: FreeConsole() drops this helper's own console, AttachConsole(pid)
// joins the target's (each gphoto2 child spawned from the GUI Electron main
// process gets its own hidden console), the helper disables Ctrl+C for
// itself, then GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0) hits every process
// on that console — which is only gphoto2.
//
// Build (no SDK needed, csc.exe ships with Windows' .NET Framework 4.x):
//   csc /nologo /target:winexe /optimize /out:gp2-ctrlc.exe gp2-ctrlc.cs
// `scripts/setup-gphoto2-windows.ps1` does this and drops the exe next to
// gphoto2.exe. Exit codes: 0 sent, 2 bad args, 3 could not attach, 4 could
// not send.
using System;
using System.Runtime.InteropServices;
using System.Threading;

static class Gp2CtrlC
{
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool FreeConsole();

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AttachConsole(uint dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetConsoleCtrlHandler(IntPtr handlerRoutine, bool add);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GenerateConsoleCtrlEvent(uint dwCtrlEvent, uint dwProcessGroupId);

    static int Main(string[] args)
    {
        uint pid;
        if (args.Length != 1 || !uint.TryParse(args[0], out pid)) return 2;

        FreeConsole();
        if (!AttachConsole(pid)) return 3;

        // A NULL handler with add=true makes THIS process ignore Ctrl+C, so
        // the event we are about to send doesn't kill the helper itself.
        SetConsoleCtrlHandler(IntPtr.Zero, true);

        const uint CTRL_C_EVENT = 0;
        bool sent = GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0);

        // Give the event time to be dispatched before detaching from the
        // target's console.
        Thread.Sleep(100);
        FreeConsole();
        return sent ? 0 : 4;
    }
}
