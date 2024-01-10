@echo off
setlocal enabledelayedexpansion

:: Liste des lecteurs où nous allons rechercher StarCitizen
set "drives=C D E F G H I J K L M N O P Q R S T U V W X Y Z"

echo Recherche du repertoire StarCitizen dans les dossiers spécifiques de chaque lecteur...

:: Parcourir chaque lecteur pour trouver StarCitizen
set "foundPaths="
set "count=1"
for %%d in (%drives%) do (
    if exist "%%d:\StarCitizen" set "foundPaths=!foundPaths!%%d:\StarCitizen;" & echo !count!. %%d:\StarCitizen & set /a "count+=1"
    if exist "%%d:\Roberts Space Industries\StarCitizen" set "foundPaths=!foundPaths!%%d:\Roberts Space Industries\StarCitizen;" & echo !count!. %%d:\Roberts Space Industries\StarCitizen & set /a "count+=1"
    if exist "%%d:\jeux\StarCitizen" set "foundPaths=!foundPaths!%%d:\jeux\StarCitizen;" & echo !count!. %%d:\jeux\StarCitizen & set /a "count+=1"
    if exist "%%d:\game\StarCitizen" set "foundPaths=!foundPaths!%%d:\game\StarCitizen;" & echo !count!. %%d:\game\StarCitizen & set /a "count+=1"
    if exist "%%d:\games\StarCitizen" set "foundPaths=!foundPaths!%%d:\games\StarCitizen;" & echo !count!. %%d:\games\StarCitizen & set /a "count+=1"
)

:: Demander à l'utilisateur de choisir un chemin
set /p choice="Entrez le numero du chemin ou vous souhaitez telecharger et executer le fichier : "

:: Extraire le chemin sélectionné
set "selectedPath="
for /f "tokens=%choice% delims=;" %%a in ("!foundPaths!") do set "selectedPath=%%a"

:: Si le chemin est vide
if "%selectedPath%"=="" (
    echo Chemin invalide.
    pause
    exit /b
)

echo Le repertoire StarCitizen a ete trouvé a l'emplacement: %selectedPath%!

:: En train de télécharger le script depuis GitHub
echo Telechargement du script depuis GitHub...
powershell -Command "Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/drrakendu78/TradSC/main/TradSC_Updater.ps1' -OutFile '%TEMP%\TradSC_Updater.ps1'"

:: Deplacer le script telecharge vers le répertoire StarCitizen
echo Déplacement du script vers le repertoire StarCitizen...
move /Y "%TEMP%\TradSC_Updater.ps1" "%selectedPath%"

:: Executer le script en arrière-plan
echo Execution du script en arrière-plan...
powershell -Command "Start-Process powershell -ArgumentList '-ExecutionPolicy Bypass -File ""%selectedPath%\TradSC_Updater.ps1""' -Verb RunAs"

:: Fermer le fichier batch
exit
