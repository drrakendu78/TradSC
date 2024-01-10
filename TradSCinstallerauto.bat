@echo off
setlocal enabledelayedexpansion

:: Liste des lecteurs où nous allons rechercher StarCitizen
set "drives=C D E F G H I J K L M N O P Q R S T U V W X Y Z"

echo Recherche du repertoire StarCitizen dans les dossiers specifiques de chaque lecteur...

:: Parcourir chaque lecteur
for %%d in (%drives%) do (
    if exist "%%d:\StarCitizen" (
        set "starCitizenPath=%%d:\StarCitizen"
        goto :found
    )
    if exist "%%d:\Roberts Space Industries\StarCitizen" (
        set "starCitizenPath=%%d:\Roberts Space Industries\StarCitizen"
        goto :found
    )
    if exist "%%d:\jeux\StarCitizen" (
        set "starCitizenPath=%%d:\jeux\StarCitizen"
        goto :found
    )
    if exist "%%d:\game\StarCitizen" (
        set "starCitizenPath=%%d:\game\StarCitizen"
        goto :found
    )
    if exist "%%d:\games\StarCitizen" (
        set "starCitizenPath=%%d:\games\StarCitizen"
        goto :found
    )
    if exist "%%d:\games\Roberts Space Industries\StarCitizen" (
        set "starCitizenPath=%%d:\games\Roberts Space Industries\StarCitizen"
        goto :found
    )
    if exist "%%d:\game\Roberts Space Industries\StarCitizen" (
        set "starCitizenPath=%%d:\game\Roberts Space Industries\StarCitizen"
        goto :found
    )
    if exist "%%d:\jeu\Roberts Space Industries\StarCitizen" (
        set "starCitizenPath=%%d:\jeu\Roberts Space Industries\StarCitizen"
        goto :found
    )
    if exist "%%d:\jeux\Roberts Space Industries\StarCitizen" (
        set "starCitizenPath=%%d:\jeux\Roberts Space Industries\StarCitizen"
        goto :found
    )
)

:: Si StarCitizen n'est pas trouve sur tous les lecteurs
echo Le répertoire StarCitizen n'a pas ete trouve sur les lecteurs disponibles.
pause
exit /b

:found
echo Le repertoire StarCitizen a ete trouvé à l'emplacement: !starCitizenPath!

:: En train de télécharger le script depuis GitHub
echo Telechargement du script depuis GitHub...
powershell -Command "Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/drrakendu78/TradSC/main/TradSC_Updater.ps1' -OutFile '%TEMP%\TradSC_Updater.ps1'"

:: Deplacer le script telecharge vers le répertoire StarCitizen
echo Déplacement du script vers le repertoire StarCitizen...
move /Y "%TEMP%\TradSC_Updater.ps1" "!starCitizenPath!"

:: Executer le script en arrière-plan
echo Execution du script en arrière-plan...
powershell -Command "Start-Process powershell -ArgumentList '-ExecutionPolicy Bypass -File ""!starCitizenPath!\TradSC_Updater.ps1""' -Verb RunAs"

:: Fermer le fichier batch
exit
