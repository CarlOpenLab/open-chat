import { createApp, watch } from "vue";
import App from "./App.vue";
import { store } from "./store";
import "./codeHighlighter";
import "@antdv-next/x-markdown/themes/index.css";
import "@antdv-next/x-markdown/themes/light.css";
import "@antdv-next/x-markdown/themes/dark.css";
import "./styles.css";

watch(
  () => store.settings?.theme,
  (t) => t && localStorage.setItem("oc.theme", JSON.stringify(t)),
);

createApp(App).mount("#app");
