import { createApp, watch } from "vue";
import App from "./App.vue";
import { store } from "./store";
import "./codeHighlighter";
import "@antdv-next/x-markdown/themes/index.css";
import "@antdv-next/x-markdown/themes/light.css";
import "@antdv-next/x-markdown/themes/dark.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/overrides.css";
import "virtual:uno.css";

watch(
  () => store.settings?.theme,
  (t) => t && localStorage.setItem("oc.theme", JSON.stringify(t)),
);

createApp(App).mount("#app");
