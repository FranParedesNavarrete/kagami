import { RoomCodeSchema } from "@kagami/shared";
import { Monitor, Smartphone } from "lucide-react";
import { useState } from "react";
import { LanguageSwitcher } from "../components/LanguageSwitcher.js";
import { useI18n } from "../i18n/i18n.js";

interface Props {
	onBeScreen: () => void;
	onJoin: (code: string) => void;
}

export function HomeView({ onBeScreen, onJoin }: Props) {
	const { t } = useI18n();
	const [code, setCode] = useState("");
	const valid = RoomCodeSchema.safeParse(code).success;

	return (
		<div className="flex min-h-screen flex-col items-center justify-center gap-10 bg-neutral-950 px-6 text-white">
			<div className="absolute right-6 top-6">
				<LanguageSwitcher />
			</div>

			<h1 className="text-5xl font-bold">{t("app.title")}</h1>

			<button
				type="button"
				onClick={onBeScreen}
				className="flex items-center gap-3 rounded-xl bg-blue-600 px-8 py-4 text-xl font-semibold hover:bg-blue-500"
			>
				<Monitor size={28} />
				{t("home.beScreen")}
			</button>
			<p className="-mt-8 text-sm text-white/50">{t("home.beScreenHint")}</p>

			<form
				className="flex flex-col items-center gap-3"
				onSubmit={(e) => {
					e.preventDefault();
					if (valid) onJoin(code);
				}}
			>
				<label
					htmlFor="room-code"
					className="flex items-center gap-2 text-white/70"
				>
					<Smartphone size={18} />
					{t("home.haveCode")}
				</label>
				<div className="flex gap-2">
					<input
						id="room-code"
						value={code}
						onChange={(e) => setCode(e.target.value.toUpperCase())}
						placeholder={t("home.codePlaceholder")}
						maxLength={4}
						className="w-32 rounded-lg bg-neutral-800 px-4 py-3 text-center text-2xl tracking-widest"
					/>
					<button
						type="submit"
						disabled={!valid}
						className="rounded-lg bg-blue-600 px-6 py-3 font-semibold disabled:bg-neutral-700 disabled:text-white/30"
					>
						{t("home.join")}
					</button>
				</div>
			</form>
		</div>
	);
}
