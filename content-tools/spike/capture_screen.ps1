# Capture the primary screen to a PNG, but only if Counter-Strike 2 is the foreground window.
# Phase 0 capture spike. Exit code 0 = saved, 2 = CS2 not in the foreground (nothing captured).
param([Parameter(Mandatory = $true)][string]$Out)

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class CcapWin {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[void][CcapWin]::SetProcessDPIAware()

$fg = [CcapWin]::GetForegroundWindow()
$fgPid = [uint32]0
[void][CcapWin]::GetWindowThreadProcessId($fg, [ref]$fgPid)
$fgName = (Get-Process -Id $fgPid -ErrorAction SilentlyContinue).ProcessName
if ($fgName -ne 'cs2') {
    Write-Output "FOREGROUND_NOT_CS2:$fgName"
    exit 2
}

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$gfx.Dispose(); $bmp.Dispose()
Write-Output ("SAVED:{0}x{1}" -f $bounds.Width, $bounds.Height)
