; Close tray-resident SnipClip before overwrite. Closing windows alone leaves
; the process alive (CloseRequested → hide), which locks snipclip.exe.
!macro NSIS_HOOK_PREINSTALL
  nsExec::ExecToLog 'taskkill /F /IM snipclip.exe /T'
  Sleep 800
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog 'taskkill /F /IM snipclip.exe /T'
  Sleep 800
!macroend
