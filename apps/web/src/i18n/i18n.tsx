import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import en from "./en.json";
import es from "./es.json";
import pt from "./pt.json";

const dictionaries = { en, es, pt } as const;
export type Lang = keyof typeof dictionaries;
export type I18nKey = keyof typeof en;

const LANG_STORAGE_KEY = "kagami-lang";

function detectLang(): Lang {
	const stored = localStorage.getItem(LANG_STORAGE_KEY);
	if (stored && stored in dictionaries) return stored as Lang;
	const browser = navigator.language.slice(0, 2);
	return browser in dictionaries ? (browser as Lang) : "en";
}

interface I18nContextValue {
	lang: Lang;
	setLang: (lang: Lang) => void;
	t: (key: I18nKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
	const [lang, setLangState] = useState<Lang>(detectLang);

	const setLang = useCallback((next: Lang) => {
		localStorage.setItem(LANG_STORAGE_KEY, next);
		setLangState(next);
	}, []);

	const t = useCallback(
		(key: I18nKey, vars?: Record<string, string | number>) => {
			const template = dictionaries[lang][key] ?? en[key] ?? key;
			if (!vars) return template;
			return Object.entries(vars).reduce(
				(acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
				template,
			);
		},
		[lang],
	);

	const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
	const ctx = useContext(I18nContext);
	if (!ctx) throw new Error("useI18n must be used within I18nProvider");
	return ctx;
}
