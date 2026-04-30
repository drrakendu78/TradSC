export interface GamePaths {
    versions: {
        [key: string]: {
            path: string;
            translated: boolean;
            up_to_date: boolean;
            release_version?: string | null;
            build_number?: string | null;
            game_version?: string | null;
            branch?: string | null;
        };
    };
}

export interface Link {
    id: number;
    name: string;
    url: string;
}

interface LanguageConfig {
    folder: string;
    enabled: boolean;
    links: Link[];
}

export interface LocalizationConfig {
    fr: LanguageConfig;
    de?: LanguageConfig;
    ita?: LanguageConfig;
    es?: LanguageConfig;
    en?: LanguageConfig;
}


interface TranslationSetting {
    link: string | null;
    settingsEN: boolean;
    lang?: string | null;
    custom?: boolean | null;
}

export interface TranslationsChoosen {
    [key: string]: TranslationSetting | null;
}

export const isGamePaths = (value: any): value is GamePaths => {
    return (
        value &&
        typeof value === "object" &&
        value.versions &&
        typeof value.versions === "object"
    );
};

export const isLocalizationConfig = (value: any): value is LocalizationConfig => {
    return (
        value &&
        typeof value === "object" &&
        value.fr &&
        typeof value.fr === "object" &&
        Array.isArray(value.fr.links)
    );
};
