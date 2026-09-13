; Keep upstream architecture selection/decompression hooks; replace only extraction.
!include "${PROJECT_DIR}\node_modules\app-builder-lib\templates\nsis\include\extractAppPackage.nsh"
!macroundef extractUsing7za
!include "${PROJECT_DIR}\installer\nsis\extractUsing7za.nsh"
