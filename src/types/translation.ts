export interface GamePaths {
    versions: {
        [key: string]: {
            path: string;
            translated: boolean;
            up_to_date: boolean;
        };
    };
}

export interface Link {
    id: number;
    name: string;
    url: string;
}

export interface LanguageConfig {
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

export interface TranslationOption {
    id: number;
    name: string;
    description: string;
    link: string;
}

export interface TranslationSetting {
    link: string | null;
    settingsEN: boolean;
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