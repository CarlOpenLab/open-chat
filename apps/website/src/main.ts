import { createApp } from "vue";
import App from "./App.vue";
import "./codeHighlighter";
import "./style.css";
import "virtual:uno.css";
import "@antdv-next/x-markdown/themes/light.css";
import "@antdv-next/x-markdown/themes/dark.css";
import "@antdv-next/x-markdown/themes/index.css";

const app = createApp(App);
app.config.errorHandler = (err, _i, info) => {
  document.title = "ERR:" + info + ":" + String((err as Error)?.stack || err).slice(0, 300);
  console.error(err, info);
};
app.mount("#app");
