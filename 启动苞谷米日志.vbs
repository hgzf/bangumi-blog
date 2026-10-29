Option Explicit

Dim shell, fileSystem, appDirectory, electronPath
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

appDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
electronPath = fileSystem.BuildPath(appDirectory, "node_modules\electron\dist\electron.exe")

If Not fileSystem.FileExists(electronPath) Then
  MsgBox "缺少 Electron 运行文件。请先恢复应用的 node_modules 文件夹。", vbCritical, "苞谷米日志"
  WScript.Quit 1
End If

shell.CurrentDirectory = appDirectory
shell.Run """" & electronPath & """ .", 0, False
