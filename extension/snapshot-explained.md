# snapshot.bat explained

`snapshot.bat` saves a snapshot of the system's state to text files, compares two snapshots, and flags what changed between them. It uses only commands built into Windows, with no PowerShell and no VBS. The on-screen text is in Spanish.

## What it produces

Everything is created next to the script:

```
snapshots\
  0001\   00_info.txt  01_sistema.txt  ...  09_software.txt
  0002\   ...
informes\
  informe_0001_vs_0002.txt     comparison report
  snapshot_0002.zip            package prepared for email
```

A snapshot is one numbered folder of text files. Each file records one aspect of the system at that moment.

## Syntax guide

| Syntax | Meaning |
|---|---|
| `%VAR%` | The value of a variable. Filled in when cmd reads the line or `( ... )` block. |
| `!VAR!` | The value of a variable, filled in when the line runs. Needs `EnableDelayedExpansion`. Used when a variable changes inside the same block. |
| `%%F` | A `for` loop variable inside a batch file. At the prompt it is written `%F`. |
| `%~dp0` | The drive and folder the script is in, ending in `\`. |
| `>` and `>>` | Send output to a file: `>` creates or replaces it, `>>` adds to the end. |
| `2>&1` | Send error messages to the same place as normal output. |
| `2>nul` and `>nul` | Throw away error messages, or normal output. `nul` discards what it receives. |
| `^` | Escape character. `^>` and `^|` pass the symbol through as text. |
| `\|` | Pipe: the output of the left command becomes the input of the right one. |
| `:name` and `goto name` | A label, and a jump to it. |
| `errorlevel` | The exit code of the last command. `0` is success. `if errorlevel N` means "N or higher". |

`!` is used only on seven lines. The others use `%`, because the variable already holds its final value when the line is read.

## 1. Setup

```bat
@echo off
setlocal EnableDelayedExpansion
title Snapshot del Sistema - Detector de cambios
color 0B
set "BASE=%~dp0"
set "SNAPDIR=%BASE%snapshots"
set "REPORTS=%BASE%informes"
if not exist "%SNAPDIR%" mkdir "%SNAPDIR%"
if not exist "%REPORTS%" mkdir "%REPORTS%"
```

- `@echo off` stops cmd from printing every command as it runs.
- `setlocal EnableDelayedExpansion` makes variable changes local to the script and turns on `!VAR!`.
- `title` sets the window's title bar. `color 0B` gives a black background (`0`) with light aqua text (`B`).
- `BASE` is the script's own folder. `SNAPDIR` and `REPORTS` are the two folders the script works in, created if missing.

## 2. Menu (`:menu`)

- `cls` clears the screen, then a header shows the computer name and user (`%COMPUTERNAME%`, `%USERNAME%`).
- The number of existing snapshots is counted with a `for /f` that runs `dir /b /ad ... | find /c /v ""`. `dir` lists the folders, one per line, and `find /c /v ""` counts the non-blank lines. The result is stored in `TOTALSNAP`.
- `set "OP="` clears the old choice, and `set /p` asks for a new one.
- A chain of `if` lines jumps to the chosen section. Anything else prints "Opcion no valida", waits 2 seconds with `timeout /t 2`, and returns to the menu.

## 3. Create a snapshot (`:snapshot`)

### Naming

Snapshots are numbered `0001`, `0002`, and so on. The numbers sort correctly by name, and the script doesn't depend on `wmic` or on the system language, which `%DATE%` does.

```bat
set "LAST=0000"
for /f "delims=" %%D in ('dir /b /ad /on "%SNAPDIR%" 2^>nul') do set "LAST=%%D"
set /a SEQ=1%LAST%-10000+1
set "DT=000%SEQ%"
set "DT=%DT:~-4%"
```

1. `LAST` starts at `0000`, meaning no snapshot yet.
2. The loop goes through the folder names in alphabetical order, overwriting `LAST` each time, so it ends up with the last, highest name.
3. `1%LAST%` puts a `1` in front, for example `10003`. `set /a` would otherwise read a number with a leading zero as octal. Subtracting `10000` and adding `1` gives the next number, `4`.
4. `000%SEQ%` pads it with zeros, and `%DT:~-4%` keeps the last four characters: `0004`.

`DEST` is `%SNAPDIR%\%DT%`, and `mkdir` creates that folder.

### The files

`00_info.txt` is started with `>` and gets the snapshot number, date and time, computer, and user. Then nine captures run, each writing a `### TITLE ###` heading with `>` and the command's output with `>>`. Commands that can fail also have `2>&1`, so an error message lands in the file instead of getting lost.

| File | Command | What it records |
|---|---|---|
| `01_sistema.txt` | `systeminfo` | Windows version, hardware, memory, updates |
| `02_red.txt` | `ipconfig /all` | Network adapters and their settings |
| `03_puertos_escucha.txt` | `netstat -ano \| findstr ...` | Ports programs are listening on |
| `04_procesos.txt` | `tasklist /svc` | Running processes and their services |
| `05_usuarios.txt` | `net user` | Local user accounts |
| `06_inicio.txt` | `reg query ...\Run` and `dir /b` | Programs that start with Windows |
| `07_tareas.txt` | `schtasks /query /fo LIST` | Scheduled tasks |
| `08_servicios.txt` | `sc query type= service state= all` | Services in any state |
| `09_software.txt` | `reg query ...\Uninstall /s /v DisplayName` | Installed software names |

Notes on a few of them:

- **Listening ports:** a listening line shows its remote side as `0.0.0.0:0` (IPv4) or `[::]:0` (IPv6), because nobody is connected yet. `findstr /C:"..."` keeps lines containing either exact phrase. The trailing space inside the quotes makes `:0` the whole port number.
- **Startup:** two registry `Run` keys (machine-wide `HKLM`, current user `HKCU`) plus the contents of the two Startup folders, one for all users (`%ProgramData%`) and one for the current user (`%APPDATA%`).
- **Software:** the `Uninstall` key is read in three places: `HKLM`, `HKLM\...\WOW6432Node`, where 32-bit programs register on 64-bit Windows, and `HKCU`. `/s` searches sub-keys, and `/v DisplayName` shows only each program's name.

At the end it prints where the snapshot was saved, waits with `pause`, and returns to the menu.

## 4. Compare two snapshots (`:comparar`)

### Choosing

```bat
set "N=0"
for /f "delims=" %%D in ('dir /b /ad /on "%SNAPDIR%" 2^>nul') do (
  set /a N+=1
  set "SNAP!N!=%%D"
  echo   [!N!] %%D
)
```

This prints a numbered list and stores each name in `SNAP1`, `SNAP2`, and so on. `!N!` is needed because `N` changes inside the loop. If `N` is less than 2, it says at least two snapshots are needed (`LSS` means "less than").

Then `set /p` asks for the older number (`A`) and the newer one (`B`). The lookup `set "NA=!SNAP%A%!"` works in two steps: `%A%` is filled in first, giving `!SNAP1!`, and then `!SNAP1!` gives the folder name `0001`. A number that isn't on the list gives an empty name.

### Validation

Each check prints a message, pauses, and returns to the menu:

- `NA` is empty: "Numero anterior no valido".
- `NB` is empty: "Numero posterior no valido".
- `NA` equals `NB`: "Debe elegir dos snapshots distintos".

If `NA` sorts after `NB` (`GTR`, greater than), the two are swapped so the older one is always first. The swap lines use `!` because they depend on each other inside one block. `TMP` holds one value while the other is copied over it.

### The report

```bat
set "INFORME=%REPORTS%\informe_%NA%_vs_%NB%.txt"
set "TMPFC=%TEMP%\snap_fc_%RANDOM%.tmp"
set "CAMBIOS=0"
```

`INFORME` is the report file, `TMPFC` is a temporary file with a random number in its name, and `CAMBIOS` counts the categories with changes. The report starts with a title, the two snapshot names, and the date and time.

### Why it copies files first

`fc` does not handle very long paths, according to the script's original comment. So the four files to compare are copied into short temporary folders (`WA` for the older snapshot, `WB` for the newer one) under `%TEMP%`. The snapshot folders themselves are never changed.

### What is compared

Only four files are compared: listening ports, users, startup programs, and installed software. The original comment explains why: network settings, services, and scheduled tasks change on their own during normal use, so comparing them would flag changes that don't matter.

### The comparison loop

```bat
fc /n "%WA%\%%F" "%WB%\%%F" > "%TMPFC%" 2>&1
if errorlevel 2 ( ... ) else if errorlevel 1 ( ... ) else ( ... )
```

`fc` compares two files, and `/n` adds line numbers to its output. Its exit code decides what happens:

| Exit code | Label | What the script does |
|---|---|---|
| `2` or more | `[ERROR]` | The files couldn't be compared. Says so on screen and in the report. |
| `1` | `[CAMBIO]` | They differ. Adds 1 to `CAMBIOS`, writes a separator and the label to the report, then appends `fc`'s output with `type`. |
| `0` | `[OK]` | No differences. Prints it on screen only. |

`if errorlevel 2` is checked first because `if errorlevel N` means "N or higher".

### Finishing

- `rd /s /q` deletes the two temporary folders, and `del` removes the temporary `fc` file.
- The report gets a summary line, and the screen shows `RESUMEN: X de 4 categorias con cambios`. Zero changes prints a "no changes" message. Otherwise it says new ports, users, or startup programs are suspicious.
- `start "" notepad "%INFORME%"` opens the report in Notepad. The empty `""` fills `start`'s title slot, so the next item is read as what to open.

## 5. Prepare an email package (`:enviar`)

1. `ULT` is set to the name of the last snapshot with the same loop used for numbering. If it is still undefined (`if not defined ULT`), the script reports that no snapshots exist and returns to the menu.
2. `ZIP` is `informes\snapshot_<name>.zip`. An older zip with the same name is deleted first.
3. The snapshot's files are copied into a short temporary folder, `%TEMP%\snap_zip_<random>\<name>`, because, as the original comment says, `tar -C` does not handle very long paths.
4. `tar -a -c -f "%ZIP%" -C "%TMPZ%" "%ULT%"` creates the zip: `-a` picks the zip format from the `.zip` extension, `-c` creates, `-f` names the file, and `-C` changes to the staging folder before adding the `<name>` folder.
5. `TARERR` saves `tar`'s exit code right away, so the next command can't overwrite it. The staging folder is deleted, and a non-zero `TARERR` prints an error and returns to the menu.
6. On success it opens a Gmail compose window with `start`, and opens File Explorer with the zip highlighted (`explorer /select,`). The script never stores passwords and never sends email. You attach the zip yourself.

## 6. Open the folder (`:abrir`)

`start "" "%SNAPDIR%"` opens the snapshots folder in File Explorer and returns to the menu.

## 7. Exit (`:fin`)

Clears the screen, prints a goodbye message, waits 2 seconds, then `endlocal` ends the local variable scope and `exit /b 0` ends the script.

## Variables

| Variable | Holds |
|---|---|
| `BASE`, `SNAPDIR`, `REPORTS` | The script's folder, the snapshots folder, the reports folder |
| `TOTALSNAP` | Number of existing snapshots, shown in the menu |
| `OP` | The menu choice |
| `LAST`, `SEQ`, `DT` | Last folder name, next number, new snapshot's name |
| `DEST` | Folder of the snapshot being created |
| `N`, `SNAP1`, `SNAP2`, ... | Counter and the numbered list of snapshot names |
| `A`, `B`, `NA`, `NB`, `TMP` | The numbers typed, the names they point to, and a swap helper |
| `INFORME`, `TMPFC`, `CAMBIOS` | Report path, temporary `fc` output file, count of changed categories |
| `WA`, `WB` | Temporary folders for the files being compared |
| `ULT`, `ZIP`, `TMPZ`, `TARERR` | Last snapshot, zip path, staging folder, `tar` exit code |
