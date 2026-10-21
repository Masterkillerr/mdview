# Dump files

A **dump file** is a snapshot of memory saved to disk, usually with the CPU registers and metadata (which process or driver was running, the call stack). You open it later to find out what was happening when something crashed or froze. Extension: `.dmp`.

It is evidence. A crash disappears when the machine restarts, but the dump keeps the state so you can find the cause without reproducing it.

## Two families

### 1. Kernel-mode dumps (system crash, BSOD)

Written when Windows bugchecks (stops with a blue screen). Covers the kernel and drivers.

| Type | Contains | Size | Default location |
|---|---|---|---|
| Small memory dump (minidump) | Stop code, crashed driver, stacks | ~256 KB | `C:\Windows\Minidump\*.dmp` |
| Kernel memory dump | Kernel-mode memory only | Varies (hundreds of MB) | `C:\Windows\MEMORY.DMP` |
| Complete memory dump | All of RAM | About the size of RAM | `C:\Windows\MEMORY.DMP` |
| Automatic memory dump | Kernel dump, size chosen by Windows | Varies | `C:\Windows\MEMORY.DMP` |

Windows 10/11 defaults to **Automatic**. Change it in `sysdm.cpl` > Advanced > Startup and Recovery > Settings.

Common stop codes (the first thing you look at):

- `0x0000000A IRQL_NOT_LESS_OR_EQUAL`: usually a driver touching memory it shouldn't
- `0x0000003B SYSTEM_SERVICE_EXCEPTION`: a system call failed, often a driver
- `0x0000007E SYSTEM_THREAD_EXCEPTION_NOT_HANDLED`: a system thread threw an error no handler caught
- `0x0000009F DRIVER_POWER_STATE_FAILURE`: a driver didn't respond to a sleep/wake request
- `0x00000133 DPC_WATCHDOG_VIOLATION`: a driver ran too long at high priority

### 2. User-mode dumps (one process)

A single program froze or crashed. Other programs keep running.

- **Task Manager**: right-click the process > *Create dump file*. Saved to `%LocalAppData%\Temp`.
- **ProcDump** (Sysinternals):

```cmd
procdump -accepteula -ma 1234
procdump -accepteula -e -ma notepad.exe
procdump -accepteula -h notepad.exe
```

  - `-ma 1234`: full dump of the process with PID 1234 right now
  - `-e`: write a dump when the process throws an exception
  - `-h`: write a dump when the window hangs (Not Responding)

## Analyzing

- **WinDbg** (Microsoft, from the Microsoft Store). Open the `.dmp` and run `!analyze -v`. It prints the stop code, the probably faulting module, and the stack.
- **Event Viewer** > Windows Logs > System > filter Event ID `1001` (source `BugCheck`). It shows the stop code and the dump path.
- **BlueScreenView** (NirSoft, third-party): quick look at minidumps. Optional.

## Not dump files (easy to mix up)

- `pagefile.sys`: virtual memory, constantly changing. Working storage, not a snapshot.
- `hiberfil.sys`: image saved when the PC hibernates. Close to a dump, but not one.

## Linux equivalent

- **Core dump**: memory of one crashed process. On Mint (systemd): `coredumpctl list` and `coredumpctl gdb <pid>`. Check the limit with `ulimit -c` (0 = off).
- **Kernel crash dump**: `kdump` writes a `vmcore` to `/var/crash/`. Analyze with `crash` or `gdb`.

## Relevance to win11-lab

A Complete dump is about the size of the VM's RAM (2 GB now). It is written to the guest disk, which lives as a qcow2 file on the SSD, so it uses your free space. For the VM, use the Small memory dump or Automatic.

## Self-check

1. What is the difference between a minidump and a complete dump? (Minidump: about 256 KB, crash context only. Complete: all of RAM.)
2. Which dump type has a process-level scope? (User-mode process dump, from Task Manager or ProcDump.)
3. Which tool analyzes a `.dmp`, and which command starts the analysis? (WinDbg, `!analyze -v`.)
