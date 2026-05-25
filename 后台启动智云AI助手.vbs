Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
command = "cmd /c cd /d """ & root & """ && node scripts\launch.js"
shell.Run command, 0, False
