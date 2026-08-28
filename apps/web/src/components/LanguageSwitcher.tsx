import { type Lang, useI18n } from "../i18n/i18n.js";

const LANGS: Lang[] = ["en", "es", "pt"];

export function LanguageSwitcher() {
	const { lang, setLang, t } = useI18n();

	return (
		<div className="flex gap-3 text-sm">
			{LANGS.map((l) => (
				<button
					key={l}
					type="button"
					onClick={() => setLang(l)}
					className={
						lang === l ? "font-bold text-white underline" : "text-white/50"
					}
				>
					{t(`lang.${l}`)}
				</button>
			))}
		</div>
	);
}
