@echo off
:: Vérifiez si le script est exécuté en tant qu'administrateur
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' == '0' (
    echo Script exécuté avec des droits d'administrateur
) else (
    echo Relancez ce script en tant qu'administrateur...
    powershell -Command "Start-Process '%~0' -Verb RunAs"
    exit
)

:: Code principal
setlocal enabledelayedexpansion

:: Liste des lecteurs à vérifier
set "drives=C D E F G H I J K L M N O P Q R S T U V W X Y Z"

:menu
cls
echo Recherche du répertoire StarCitizen...

:: Initialisation des variables
set "foundPaths="
set "count=1"

:: Parcourir chaque lecteur pour trouver StarCitizen
for %%d in (%drives%) do (
    for %%p in (
        "StarCitizen"
        "Roberts Space Industries\StarCitizen"
        "jeux\StarCitizen"
        "jeu\StarCitizen"
        "game\StarCitizen"
        "games\StarCitizen"
        "jeux\Roberts Space Industries\StarCitizen"
        "jeu\Roberts Space Industries\StarCitizen"
        "games\Roberts Space Industries\StarCitizen"
        "game\Roberts Space Industries\StarCitizen"
        "Program Files\Roberts Space Industries\StarCitizen"
    ) do (
        if exist "%%d:\%%~p" (
            set "foundPaths=!foundPaths!%%d:\%%~p;" 
            echo !count!. %%d:\%%~p
            set /a "count+=1"
        )
    )
)

:: Demander à l'utilisateur de choisir un chemin
set /p choice="Entrez le numéro du chemin : "

:: Extraire le chemin sélectionné
set "selectedPath="
for /f "tokens=%choice% delims=;" %%a in ("!foundPaths!") do set "selectedPath=%%a"

:: Si le chemin est vide
if "%selectedPath%"=="" (
    echo Chemin invalide.
    pause
    goto menu
)

echo Le répertoire StarCitizen a été trouvé à l'emplacement: %selectedPath%!

:: Téléchargement de l'exécutable depuis GitHub
echo Téléchargement de l'exécutable depuis GitHub...
powershell -Command "Invoke-WebRequest -Uri 'https://github.com/drrakendu78/TradSC/raw/refs/heads/main/TradSC_Updater.exe' -OutFile '%TEMP%\TradSC_Updater.exe'"

:: Déplacement et remplacement de l'exécutable téléchargé
echo Déplacement et remplacement de l'exécutable vers le répertoire StarCitizen...
move /Y "%TEMP%\TradSC_Updater.exe" "%selectedPath%"

:: Exécution de l'exécutable
echo Exécution de l'exécutable...
start "" "%selectedPath%\TradSC_Updater.exe"

:: Fermeture du fichier batch
exit