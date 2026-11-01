: << 'CMDBLOCK'
@echo off
REM Cross-platform polyglot launcher for the Archdocs plugin hook scripts.
REM Adapted from hooks/run-hook.cmd in obra/superpowers
REM (Copyright (c) 2025 Jesse Vincent, MIT License).
REM On Windows: cmd.exe runs the batch portion, which finds and calls bash.
REM On Unix: the shell treats the batch portion as a no-op heredoc.
REM Hook scripts use extensionless names so Claude Code's Windows .sh
REM detection does not interfere.
REM Usage: run-hook.cmd <script-name> [args...]

if "%~1"=="" (
    echo run-hook.cmd: missing script name >&2
    exit /b 1
)

setlocal
set "HOOK_DIR=%~dp0"
set "BASH_EXE="

REM Prefer standard Git for Windows locations, then a per-user install.
if exist "C:\Program Files\Git\bin\bash.exe" set "BASH_EXE=C:\Program Files\Git\bin\bash.exe"
if not defined BASH_EXE if exist "C:\Program Files (x86)\Git\bin\bash.exe" set "BASH_EXE=C:\Program Files (x86)\Git\bin\bash.exe"
REM Check LOCALAPPDATA is defined before using the per-user install path.
if not defined BASH_EXE if defined LOCALAPPDATA if exist "%LOCALAPPDATA%\Programs\Git\bin\bash.exe" set "BASH_EXE=%LOCALAPPDATA%\Programs\Git\bin\bash.exe"
REM Fall back to bash on PATH, excluding WSL launchers and Windows app aliases.
if not defined BASH_EXE if defined SystemRoot for /f "delims=" %%B in ('"%SystemRoot%\System32\where.exe" $PATH:bash 2^>nul') do if not defined BASH_EXE if not "%%~xB"=="" if /i not "%%~dpB"=="%SystemRoot%\System32\" if /i not "%%~dpB"=="%SystemRoot%\Sysnative\" if /i not "%%~dpB"=="%LOCALAPPDATA%\Microsoft\WindowsApps\" set "BASH_EXE=%%B"

REM Silently skip hooks when bash is unavailable.
if not defined BASH_EXE exit /b 0

REM Run bash outside a parenthesized block so ERRORLEVEL is read after it exits.
"%BASH_EXE%" "%HOOK_DIR%%~1" %2 %3 %4 %5 %6 %7 %8 %9
exit /b %ERRORLEVEL%
CMDBLOCK

case "$0" in
  */*|*\\*) SCRIPT_DIR="$(cd "${0%[/\\]*}" && pwd)" ;;
  *) SCRIPT_DIR="$(pwd)" ;;
esac
SCRIPT_NAME="$1"
shift
exec "${BASH:-bash}" "${SCRIPT_DIR}/${SCRIPT_NAME}" "$@"
