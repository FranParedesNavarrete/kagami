import { Monitor, Smartphone } from "lucide-react";
import { CodeInput } from "../components/CodeInput.js";
import { LanguageSwitcher } from "../components/LanguageSwitcher.js";
import { Lockup } from "../components/Lockup.js";
import { useI18n } from "../i18n/i18n.js";

interface Props {
	onBeScreen: () => void;
	onJoin: (code: string) => void;
}

// Dos caminos con su propio sitio, no un boton azul enorme y una caja
// "CODE" pegada a un "Join" gris (encargo de rediseño, parte 9/10).
export function HomeView({ onBeScreen, onJoin }: Props) {
	const { t } = useI18n();

	return (
		<div className="flex min-h-screen flex-col bg-ink text-silver">
			<header className="flex items-center justify-between px-5 py-4">
				<Lockup />
				<LanguageSwitcher />
			</header>

			<main className="flex flex-1 flex-col justify-center gap-8 px-5 py-8">
				<div className="max-w-[560px]">
					<h1 className="font-display text-[26px] font-semibold tracking-tight">
						{t("home.title")}
					</h1>
					<p className="mt-1.5 text-sm text-muted">{t("home.subtitle")}</p>
				</div>

				<div className="grid max-w-[560px] grid-cols-1 gap-4 sm:grid-cols-2">
					<div className="flex flex-col gap-3 rounded-md border border-line bg-ink-2 p-6">
						<Monitor size={22} strokeWidth={1.6} className="text-glass" />
						<div>
							<p className="mb-0.5 font-semibold text-silver">
								{t("home.beScreen")}
							</p>
							<p className="text-[13px] text-muted">{t("home.beScreenHint")}</p>
						</div>
						<button
							type="button"
							onClick={onBeScreen}
							className="mt-auto w-full cursor-pointer rounded-md bg-silver px-4 py-2.5 text-sm font-semibold text-ink hover:bg-white"
						>
							{t("home.showCode")}
						</button>
					</div>

					<div className="flex flex-col gap-3 rounded-md border border-line bg-ink-2 p-6">
						<Smartphone size={22} strokeWidth={1.6} className="text-glass" />
						<div>
							<p className="mb-0.5 font-semibold text-silver">
								{t("home.haveCode")}
							</p>
							<p className="text-[13px] text-muted">{t("home.haveCodeHint")}</p>
						</div>
						<CodeInput onComplete={onJoin} />
					</div>
				</div>
			</main>
		</div>
	);
}
