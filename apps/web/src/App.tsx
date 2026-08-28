import { RoomCodeSchema } from "@kagami/shared";
import { useState } from "react";
import { I18nProvider } from "./i18n/i18n.js";
import { HomeView } from "./views/HomeView.js";
import { ScreenView } from "./views/screen/ScreenView.js";
import { SenderView } from "./views/sender/SenderView.js";

type Route =
	| { kind: "home" }
	| { kind: "screen" }
	| { kind: "sender"; code: string };

function initialRoute(): Route {
	const code = new URLSearchParams(location.search).get("code")?.toUpperCase();
	if (code && RoomCodeSchema.safeParse(code).success)
		return { kind: "sender", code };
	return { kind: "home" };
}

export function App() {
	const [route, setRoute] = useState<Route>(initialRoute);

	return (
		<I18nProvider>
			{route.kind === "home" && (
				<HomeView
					onBeScreen={() => setRoute({ kind: "screen" })}
					onJoin={(code) => setRoute({ kind: "sender", code })}
				/>
			)}
			{route.kind === "screen" && <ScreenView />}
			{route.kind === "sender" && (
				<SenderView
					initialCode={route.code}
					onExit={() => setRoute({ kind: "home" })}
				/>
			)}
		</I18nProvider>
	);
}
