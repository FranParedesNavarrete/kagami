import { type Lang, useI18n } from "../i18n/i18n.js";

const LANGS: Lang[] = ["en", "es", "pt"];

// Ya no es un enlace subrayado (encargo de rediseño, parte 3): botones
// reales, activo marcado con fondo --ink-3 y texto --silver, igual que
// el resto de la app.
export function LanguageSwitcher() {
	const { lang, setLang, t } = useI18n();

	return (
		<div className="flex gap-0.5 text-xs">
			{LANGS.map((l) => (
				<button
					key={l}
					type="button"
					aria-pressed={lang === l}
					aria-label={t(`lang.${l}`)}
					title={t(`lang.${l}`)}
					onClick={() => setLang(l)}
					className={`cursor-pointer rounded-sm px-2 py-1 uppercase ${
						lang === l ? "bg-ink-3 text-silver" : "text-faint hover:text-muted"
					}`}
				>
					{l}
				</button>
			))}
		</div>
	);
}
