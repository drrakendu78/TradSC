@echo off
setlocal enabledelayedexpansion

:: Liste des lecteurs où nous allons rechercher StarCitizen
set "drives=C D E F G H I J K L M N O P Q R S T U V W X Y Z"

:: Parcourir chaque lecteur pour trouver le répertoire StarCitizen
for %%d in (%drives%) do (
    if exist "%%d:\Program Files\Roberts Space Industries\StarCitizen" (
        set "starCitizenPath=%%d:\Program Files\Roberts Space Industries\StarCitizen"
        goto foundPath
    )
)

:: Si StarCitizen n'est pas trouve sur tous les lecteurs
echo Le répertoire StarCitizen n'a pas ete trouvé sur les lecteurs disponibles.
exit /b

:foundPath
echo Le répertoire StarCitizen a ete trouvé à l'emplacement: %starCitizenPath%

:: En train de telecharger le script depuis GitHub
echo Telechargement du script depuis GitHub...
powershell -Command "Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/drrakendu78/TradSC/main/TradSC_Updater.ps1' -OutFile '%TEMP%\TradSC_Updater.ps1'"

:: Déplacez le script téléchargé vers le répertoire StarCitizen
echo Deplacement du script vers le répertoire StarCitizen...
move /Y "%TEMP%\TradSC_Updater.ps1" "%starCitizenPath%"

:: Exécutez le script en arrière-plan
echo Execution du script en arrière-plan...
powershell -Command "Start-Process powershell -ArgumentList '-ExecutionPolicy Bypass -File ""%starCitizenPath%\TradSC_Updater.ps1""' -Verb RunAs"

:: Fermez le fichier batch
exit
