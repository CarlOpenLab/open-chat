<script setup lang="ts">
import {
  ArrowDown as ArrowDownOutlined,
  ArrowRight as ArrowRightOutlined,
  Bot as RobotOutlined,
  Check as CheckOutlined,
  Code2 as CodeOutlined,
  FileText as FileTextOutlined,
  GitBranch as BranchesOutlined,
  Globe2 as GlobalOutlined,
  LayoutGrid as AppstoreOutlined,
  Lightbulb as BulbOutlined,
  Menu as MenuOutlined,
  MessageCircle as MessageOutlined,
  Moon as MoonOutlined,
  Paperclip as PaperClipOutlined,
  ShieldCheck as SafetyCertificateOutlined,
  Sparkles,
  Sun as SunOutlined,
  Wrench as ToolOutlined,
  Zap as ThunderboltOutlined,
} from "@lucide/vue";
import { Button, Collapse, CollapsePanel } from "antdv-next";
import { onBeforeUnmount, onMounted, ref } from "vue";
import LandingChatDemo from "../components/landing/LandingChatDemo.vue";

interface Props {
  dark: boolean;
}

interface Emits {
  (e: "navigate", path: string): void;
  (e: "toggleTheme"): void;
}

defineProps<Props>();
const emit = defineEmits<Emits>();

const mobileMenuOpen = ref(false);
const headerScrolled = ref(false);
let revealObserver: IntersectionObserver | undefined;

const go = (path: string) => emit("navigate", path);
const scrollToSection = (id: string) => {
  document.querySelector(`#${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  mobileMenuOpen.value = false;
};
const onScroll = () => {
  headerScrolled.value = window.scrollY > 12;
};
const onKeydown = (event: KeyboardEvent) => {
  if (event.key === "Escape") mobileMenuOpen.value = false;
};
const onDocumentClick = (event: MouseEvent) => {
  if (!(event.target as Element).closest(".nav-shell")) mobileMenuOpen.value = false;
};

onMounted(() => {
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("keydown", onKeydown);
  document.addEventListener("click", onDocumentClick);
  revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("visible");
        revealObserver?.unobserve(entry.target);
      });
    },
    { threshold: 0.12 },
  );
  document.querySelectorAll(".landing-page .reveal").forEach((element, index) => {
    (element as HTMLElement).style.transitionDelay = `${Math.min(index % 4, 3) * 70}ms`;
    revealObserver?.observe(element);
  });
});
onBeforeUnmount(() => {
  window.removeEventListener("scroll", onScroll);
  window.removeEventListener("keydown", onKeydown);
  document.removeEventListener("click", onDocumentClick);
  revealObserver?.disconnect();
});
</script>

<template>
  <div class="landing-page">
    <a class="skip-link" href="#main">跳到主要内容</a>

    <header class="site-header" :class="{ scrolled: headerScrolled }">
      <nav class="nav-shell" aria-label="主导航">
        <a class="brand" href="#top" aria-label="Open Chat 首页">
          <span class="brand-mark"><Sparkles /></span><span>Open Chat</span>
        </a>
        <div class="nav-links" :class="{ open: mobileMenuOpen }" @click="mobileMenuOpen = false">
          <a href="#features">功能</a>
          <a href="#architecture">架构</a>
          <a href="#pricing">版本</a>
          <a href="#faq">FAQ</a>
        </div>
        <div class="nav-actions">
          <button class="login-link" type="button" @click="go('/auth')">登录</button>
          <Button
            type="text"
            shape="circle"
            :aria-label="dark ? '切换浅色模式' : '切换深色模式'"
            @click="emit('toggleTheme')"
          >
            <MoonOutlined v-if="!dark" /><SunOutlined v-else />
          </Button>
          <Button type="primary" class="desktop-cta" @click="go('/chat')">
            打开工作区 <ArrowRightOutlined />
          </Button>
          <Button
            class="menu-button"
            type="text"
            shape="circle"
            :aria-label="mobileMenuOpen ? '关闭导航菜单' : '打开导航菜单'"
            :aria-expanded="mobileMenuOpen"
            @click="mobileMenuOpen = !mobileMenuOpen"
          >
            <MenuOutlined />
          </Button>
        </div>
      </nav>
    </header>

    <main id="main">
      <section id="top" class="hero">
        <div class="hero-copy reveal">
          <div class="eyebrow"><i></i> OPEN CHAT STARTER</div>
          <h1>Open Chat</h1>
          <p>
            从一条消息开始，搭建完整的 AI 产品。多会话、模型切换、深度思考与流式回答，已经准备就绪。
          </p>
          <div class="hero-actions">
            <Button type="primary" size="large" @click="go('/chat')">
              <MessageOutlined /> 立即体验
            </Button>
            <Button size="large" @click="scrollToSection('architecture')"
              >查看模板 <ArrowDownOutlined
            /></Button>
          </div>
          <div class="hero-meta">
            <span><CheckOutlined /> antdv-next</span>
            <span><CheckOutlined /> shadcn tokens</span>
            <span><CheckOutlined /> 响应式</span>
          </div>
        </div>
        <LandingChatDemo id="demo" class="reveal" />
      </section>

      <section class="proof-strip" aria-label="产品能力">
        <div class="section-inner proof-inner">
          <span>为真实 AI 产品准备</span>
          <div>
            <span><AppstoreOutlined /> 多模型</span>
            <span><ThunderboltOutlined /> 流式输出</span>
            <span><FileTextOutlined /> Markdown</span>
            <span><SafetyCertificateOutlined /> 本地持久化</span>
          </div>
        </div>
      </section>

      <section id="features" class="section feature-section">
        <div class="section-inner">
          <div class="section-heading reveal">
            <p class="section-kicker">完整交互</p>
            <h2>不只是一个输入框。</h2>
            <p>从会话组织到答案渲染，覆盖用户对现代 AI 助手的核心预期。</p>
          </div>

          <div class="feature-grid">
            <article class="feature feature-wide reveal">
              <div>
                <span class="feature-index">01</span>
                <h3>多会话工作区</h3>
                <p>历史记录、草稿状态与本地持久化保持在同一个清晰的侧边栏中。</p>
              </div>
              <div class="sidebar-visual" aria-hidden="true">
                <div><span class="visual-logo"></span><b></b></div>
                <div class="visual-new"><i></i><b></b></div>
                <div class="visual-line active"><MessageOutlined /><b></b></div>
                <div class="visual-line"><MessageOutlined /><b></b></div>
                <div class="visual-line"><MessageOutlined /><b></b></div>
              </div>
            </article>

            <article class="feature reveal">
              <span class="feature-icon"><BranchesOutlined /></span>
              <span class="feature-index">02</span>
              <h3>模型自由切换</h3>
              <p>通过服务端 Provider 配置，为快速回答和深度推理选择不同模型。</p>
              <div class="model-visual" aria-hidden="true">
                <span class="selected"><RobotOutlined /> Qwen Plus <CheckOutlined /></span>
                <span><BulbOutlined /> Reasoner</span>
                <span><ThunderboltOutlined /> Mini</span>
              </div>
            </article>

            <article class="feature reveal">
              <span class="feature-icon"><PaperClipOutlined /></span>
              <span class="feature-index">03</span>
              <h3>复杂内容清晰呈现</h3>
              <p>Markdown、代码块、Mermaid 图表与思考过程都有适合阅读的呈现方式。</p>
              <div class="context-visual" aria-hidden="true">
                <span><FileTextOutlined /><b>release-plan.md</b><small>Markdown</small></span>
                <span><GlobalOutlined /><b>Mermaid</b><small>可视化</small></span>
              </div>
            </article>

            <article class="feature feature-wide code-feature reveal">
              <div>
                <span class="feature-index">04</span>
                <h3>从模板继续开发</h3>
                <p>请求层、聊天状态和展示组件边界清晰，可以直接接入自己的业务能力。</p>
              </div>
              <div class="code-visual">
                <header>
                  <span><CodeOutlined /> provider.ts</span><span>ready</span>
                </header>
                <pre><code><span>const</span> provider = createProvider({
  model: <b>"your-model"</b>,
  stream: <b>true</b>,
})</code></pre>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section id="architecture" class="section architecture-section">
        <div class="section-inner architecture-grid">
          <div class="architecture-copy reveal">
            <p class="section-kicker">STARTER ARCHITECTURE</p>
            <h2>界面、状态和请求层都可以继续扩展。</h2>
            <p>保留品牌空间，同时缩短从原型到可用产品的距离。</p>
            <button class="text-link" type="button" @click="go('/chat')">
              打开工作区 <ArrowRightOutlined />
            </button>
          </div>
          <div class="architecture-list reveal">
            <div>
              <span>01</span>
              <section>
                <strong>Chat shell</strong>
                <p>响应式侧栏、会话列表、消息流与输入区。</p>
              </section>
              <AppstoreOutlined />
            </div>
            <div>
              <span>02</span>
              <section>
                <strong>Interaction states</strong>
                <p>空状态、流式生成、错误、停止与重试。</p>
              </section>
              <ThunderboltOutlined />
            </div>
            <div>
              <span>03</span>
              <section>
                <strong>Theme tokens</strong>
                <p>antdv-next 组件与 shadcn Zinc 语义变量。</p>
              </section>
              <ToolOutlined />
            </div>
            <div>
              <span>04</span>
              <section>
                <strong>Provider gateway</strong>
                <p>统一管理模型配置与 OpenAI-like 请求。</p>
              </section>
              <BranchesOutlined />
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" class="section offer-section">
        <div class="section-inner">
          <div class="offer-intro reveal">
            <div>
              <p class="section-kicker">READY TO BUILD</p>
              <h2>把基础交互交给模板。</h2>
            </div>
            <p>
              从可运行的 Chat
              出发，把时间留给模型接入与业务逻辑。当前仓库已经覆盖请求、流式渲染与本地会话。
            </p>
          </div>
          <div class="workbench reveal">
            <article class="workbench-copy">
              <div class="workbench-status">
                <span>OPEN CHAT</span><span><i></i> AVAILABLE</span>
              </div>
              <div>
                <small>Production-ready foundation</small>
                <h3>开源 AI 工作区</h3>
                <p>直接配置模型网关，不必重新搭建 Chat 产品的基础体验。</p>
              </div>
              <ul>
                <li>
                  <AppstoreOutlined /><span
                    ><strong>完整会话架构</strong><small>多会话与本地持久化</small></span
                  >
                </li>
                <li>
                  <BranchesOutlined /><span
                    ><strong>模型接入层</strong><small>统一 Provider 与配置</small></span
                  >
                </li>
                <li>
                  <ThunderboltOutlined /><span
                    ><strong>流式状态覆盖</strong><small>生成、停止、错误与重试</small></span
                  >
                </li>
                <li>
                  <ToolOutlined /><span
                    ><strong>shadcn 主题</strong><small>语义 tokens 与明暗模式</small></span
                  >
                </li>
              </ul>
              <Button size="large" class="inverse-button" @click="go('/chat')"
                >开始对话 <ArrowRightOutlined
              /></Button>
            </article>
            <section class="manifest" aria-label="项目能力清单">
              <header>
                <span><CodeOutlined /> open-chat.config.ts</span><b>ready</b>
              </header>
              <pre><code><span>export default</span> defineOpenChat({
  model: <b>"your-provider"</b>,
  streaming: <b>true</b>,
  markdown: <b>true</b>,
  theme: <b>"shadcn"</b>
})</code></pre>
              <div><span>01</span><strong>chat-shell</strong><CheckOutlined /></div>
              <div><span>02</span><strong>message-stream</strong><CheckOutlined /></div>
              <div><span>03</span><strong>local-storage</strong><CheckOutlined /></div>
              <div><span>04</span><strong>theme-tokens</strong><CheckOutlined /></div>
            </section>
          </div>
          <div class="starter-strip reveal">
            <div>
              <span class="starter-play"><ArrowRightOutlined /></span
              ><span
                ><strong>先从在线体验开始</strong
                ><small>无需注册，直接测试会话、模型切换与流式回答。</small></span
              >
            </div>
            <Button @click="go('/chat')">打开 Chat 工作区 <ArrowRightOutlined /></Button>
          </div>
        </div>
      </section>

      <section id="faq" class="section faq-section">
        <div class="section-inner faq-grid">
          <div class="reveal">
            <p class="section-kicker">FAQ</p>
            <h2>常见问题</h2>
          </div>
          <Collapse class="reveal" ghost accordion>
            <CollapsePanel key="1" header="Open Chat 是完整的 AI 应用吗？">
              它是一套可运行的 AI Chat 工作区，已经具备模型请求、流式回答、Markdown
              渲染和会话持久化，认证服务可以按项目接入。
            </CollapsePanel>
            <CollapsePanel key="2" header="可以替换成自己的模型和品牌吗？">
              可以。模型由服务端配置管理，界面颜色、字体、圆角和组件状态都使用语义 token 组织。
            </CollapsePanel>
            <CollapsePanel key="3" header="支持移动端和深色模式吗？">
              支持。落地页、登录页和 Chat 工作区都使用响应式布局，并共享同一套 Zinc 明暗主题。
            </CollapsePanel>
          </Collapse>
        </div>
      </section>

      <section class="final-cta">
        <div class="section-inner reveal">
          <div>
            <p class="section-kicker">OPEN CHAT</p>
            <h2>下一条消息，可能就是产品的开始。</h2>
          </div>
          <Button size="large" class="inverse-button" @click="go('/chat')"
            >立即体验 <ArrowRightOutlined
          /></Button>
        </div>
      </section>
    </main>

    <footer class="site-footer">
      <div class="section-inner">
        <a class="brand" href="#top"
          ><span class="brand-mark"><Sparkles /></span><span>Open Chat</span></a
        >
        <p>AI Chat workspace starter.</p>
        <nav>
          <a href="#features">功能</a><a href="#pricing">版本</a><a href="#faq">FAQ</a
          ><button type="button" @click="go('/auth')">登录</button>
        </nav>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.landing-page {
  min-height: 100dvh;
  background: var(--background);
  font-size: 16px;
  color: var(--foreground);
}
.site-header {
  position: fixed;
  z-index: 20;
  inset: 0 0 auto;
  height: 64px;
  border-bottom: 1px solid transparent;
  background: color-mix(in srgb, var(--background) 88%, transparent);
  backdrop-filter: blur(16px);
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease;
}
.site-header.scrolled {
  border-color: var(--border);
  box-shadow: var(--shadow-sm);
}
.nav-shell {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 24px;
  width: min(1240px, calc(100% - 48px));
  height: 100%;
  margin: 0 auto;
}
.brand {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  gap: 10px;
  width: fit-content;
  color: var(--foreground);
  font-weight: 650;
  text-decoration: none;
}
.brand-mark {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 5px;
  background: var(--foreground);
  color: var(--background);
}
.brand-mark :deep(svg) {
  width: 16px;
  height: 16px;
}
.nav-links {
  display: flex;
  align-items: center;
  gap: 30px;
}
.nav-links a,
.login-link {
  border: 0;
  background: transparent;
  color: var(--muted-foreground);
  font-size: 14px;
  text-decoration: none;
  cursor: pointer;
  transition: color 150ms ease;
}
.nav-links a:hover,
.login-link:hover {
  color: var(--foreground);
}
.nav-actions {
  display: flex;
  justify-self: end;
  align-items: center;
  gap: 8px;
}
.nav-actions :deep(.ant-btn-circle),
.menu-button {
  width: 40px;
  min-width: 40px;
  height: 40px;
}
.menu-button {
  display: none;
}
.hero {
  position: relative;
  overflow: hidden;
  padding: 138px 24px 72px;
}
.hero-copy {
  position: relative;
  z-index: 1;
  max-width: 760px;
  margin: 0 auto 56px;
  text-align: center;
}
.eyebrow,
.section-kicker {
  display: flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  margin: 0 0 16px;
  color: var(--muted-foreground);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
  font-weight: 600;
}
.eyebrow {
  margin-inline: auto;
}
.eyebrow i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 3px var(--success-subtle);
}
.hero h1 {
  margin: 0;
  font-size: 72px;
  font-weight: 720;
  line-height: 0.98;
}
.hero-copy > p {
  max-width: 660px;
  margin: 24px auto 0;
  color: var(--muted-foreground);
  font-size: 19px;
  line-height: 1.75;
  text-wrap: balance;
}
.hero-actions,
.hero-meta {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
}
.hero-actions {
  gap: 10px;
  margin-top: 30px;
}
.hero-actions :deep(.ant-btn) {
  min-height: 48px;
  padding-inline: 20px;
}
.hero-meta {
  gap: 18px;
  margin-top: 22px;
  color: var(--muted-foreground);
  font-size: 12px;
}
.hero-meta span {
  display: flex;
  align-items: center;
  gap: 6px;
}
.hero > :deep(.demo-window) {
  position: relative;
  z-index: 2;
  margin: 0 auto;
}
.section-inner {
  width: min(1160px, calc(100% - 48px));
  margin: 0 auto;
}
.proof-strip {
  border-block: 1px solid var(--border);
  background: var(--subtle);
}
.proof-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-height: 74px;
}
.proof-inner > span {
  color: var(--muted-foreground);
  font-size: 12px;
  font-weight: 600;
}
.proof-inner > div {
  display: flex;
  flex-wrap: wrap;
  gap: 28px;
}
.proof-inner div span {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.proof-inner :deep(svg) {
  color: var(--muted-foreground);
}
.section {
  padding: 120px 0;
}
.section-heading {
  max-width: 720px;
  margin: 0 auto 56px;
  text-align: center;
}
.section-heading .section-kicker {
  margin-inline: auto;
}
.section-heading h2,
.architecture-copy h2,
.offer-intro h2,
.faq-grid h2,
.final-cta h2 {
  margin: 0;
  font-size: 42px;
  font-weight: 680;
  line-height: 1.14;
  text-wrap: balance;
}
.section-heading > p:last-child {
  max-width: 580px;
  margin: 16px auto 0;
  color: var(--muted-foreground);
  line-height: 1.75;
}
.feature-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-top: 1px solid var(--border);
  border-left: 1px solid var(--border);
}
.feature {
  position: relative;
  min-height: 380px;
  overflow: hidden;
  padding: 34px;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.feature-wide {
  display: grid;
  grid-template-columns: 0.85fr 1.15fr;
  align-items: center;
  gap: 30px;
}
.feature-index {
  display: block;
  margin-bottom: 20px;
  color: var(--muted-foreground);
  font-family: ui-monospace, monospace;
  font-size: 11px;
}
.feature h3 {
  margin: 0;
  font-size: 22px;
  line-height: 1.25;
}
.feature p {
  max-width: 410px;
  margin: 12px 0 0;
  color: var(--muted-foreground);
  font-size: 14px;
  line-height: 1.75;
}
.feature-icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  margin-bottom: 40px;
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: var(--shadow-sm);
}
.feature-icon :deep(svg) {
  width: var(--icon-lg);
  height: var(--icon-lg);
}
.sidebar-visual {
  align-self: end;
  width: 88%;
  min-height: 270px;
  justify-self: end;
  padding: 20px 16px;
  border: 1px solid var(--border);
  border-bottom: 0;
  border-radius: 7px 7px 0 0;
  background: var(--subtle);
  box-shadow: var(--shadow-lg);
  transform: translateY(34px);
}
.sidebar-visual > div {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 32px;
  padding: 0 8px;
  border-radius: 4px;
}
.sidebar-visual > div:first-child {
  margin-bottom: 26px;
  padding: 0;
}
.visual-logo {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  background: var(--foreground);
}
.sidebar-visual b {
  width: 64%;
  height: 6px;
  border-radius: 3px;
  background: var(--border);
}
.sidebar-visual .visual-new {
  margin-bottom: 14px;
  border: 1px solid var(--border);
  background: var(--background);
}
.visual-new i {
  width: 12px;
  height: 12px;
  border: 1px solid var(--muted-foreground);
}
.visual-line {
  color: var(--muted-foreground);
}
.visual-line.active {
  background: var(--muted);
  color: var(--foreground);
}
.model-visual {
  width: 80%;
  margin: 44px auto 0;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--background);
  box-shadow: var(--shadow-lg);
  transform: rotate(-2deg);
}
.model-visual span {
  display: grid;
  grid-template-columns: 20px 1fr auto;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 9px;
  border-radius: 4px;
  color: var(--muted-foreground);
  font-size: 11px;
}
.model-visual .selected {
  background: var(--muted);
  color: var(--foreground);
}
.context-visual {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 44px;
}
.context-visual span {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  grid-template-rows: auto auto;
  align-items: center;
  padding: 11px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--subtle);
}
.context-visual :deep(svg) {
  grid-row: 1 / 3;
}
.context-visual b,
.context-visual small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.context-visual b {
  font-size: 10px;
}
.context-visual small {
  color: var(--muted-foreground);
  font-size: 9px;
}
.code-visual {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--subtle);
  color: var(--foreground);
  box-shadow: var(--shadow-lg);
  transition:
    background-color 200ms ease,
    border-color 200ms ease,
    color 200ms ease;
}
.code-visual header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 38px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  color: var(--muted-foreground);
  font-size: 10px;
}
.code-visual header span {
  display: flex;
  align-items: center;
  gap: 7px;
}
.code-visual pre,
.manifest pre {
  margin: 0;
  overflow-x: auto;
  font-family: ui-monospace, monospace;
}
.code-visual pre {
  padding: 24px 20px;
  font-size: 11px;
  line-height: 1.9;
}
.code-visual code span {
  color: var(--muted-foreground);
}
.code-visual code b {
  color: var(--foreground);
  font-weight: 500;
}
.manifest code span {
  color: var(--muted-foreground);
}
.manifest code b {
  color: var(--foreground);
  font-weight: 500;
}
.architecture-section {
  border-block: 1px solid var(--border);
  background: var(--subtle);
}
.architecture-grid {
  display: grid;
  grid-template-columns: 0.85fr 1.15fr;
  align-items: start;
  gap: 96px;
}
.architecture-copy {
  position: sticky;
  top: 112px;
}
.architecture-copy > p:nth-of-type(2) {
  max-width: 500px;
  margin: 18px 0 0;
  color: var(--muted-foreground);
  line-height: 1.75;
}
.text-link {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 26px;
  padding: 0 0 4px;
  border: 0;
  border-bottom: 1px solid var(--foreground);
  background: transparent;
  color: var(--foreground);
  font-weight: 600;
  cursor: pointer;
}
.architecture-list {
  border-top: 1px solid var(--border);
}
.architecture-list > div {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 32px;
  align-items: center;
  gap: 18px;
  min-height: 132px;
  border-bottom: 1px solid var(--border);
}
.architecture-list > div > span {
  align-self: start;
  padding-top: 28px;
  color: var(--muted-foreground);
  font-family: ui-monospace, monospace;
  font-size: 10px;
}
.architecture-list section strong {
  font-size: 16px;
}
.architecture-list section p {
  margin: 6px 0 0;
  color: var(--muted-foreground);
  font-size: 13px;
}
.architecture-list > div > :deep(svg) {
  color: var(--muted-foreground);
}
.offer-section {
  background: var(--subtle);
}
.offer-intro {
  display: grid;
  grid-template-columns: 0.9fr 1.1fr;
  align-items: end;
  gap: 80px;
  margin-bottom: 48px;
}
.offer-intro > p {
  margin: 0;
  color: var(--muted-foreground);
  line-height: 1.8;
}
.workbench {
  display: grid;
  grid-template-columns: 1.04fr 0.96fr;
  min-height: 550px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-bottom: 0;
  border-radius: 8px 8px 0 0;
  background: var(--background);
  color: var(--foreground);
  box-shadow: var(--shadow-xl);
  transition:
    background-color 200ms ease,
    border-color 200ms ease,
    color 200ms ease;
}
.workbench-copy {
  display: flex;
  flex-direction: column;
  gap: 34px;
  padding: 44px 48px;
}
.workbench-status {
  display: flex;
  justify-content: space-between;
  color: var(--muted-foreground);
  font-family: ui-monospace, monospace;
  font-size: 10px;
}
.workbench-status span:last-child {
  display: flex;
  align-items: center;
  gap: 7px;
}
.workbench-status i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
}
.workbench-copy small {
  color: var(--muted-foreground);
}
.workbench-copy h3 {
  margin: 10px 0 0;
  font-size: 34px;
}
.workbench-copy div > p {
  max-width: 500px;
  margin: 12px 0 0;
  color: var(--muted-foreground);
  font-size: 14px;
  line-height: 1.75;
}
.workbench-copy ul {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--border);
  list-style: none;
}
.workbench-copy li {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-height: 88px;
  border-bottom: 1px solid var(--border);
  color: var(--muted-foreground);
}
.workbench-copy li:nth-child(odd) {
  border-right: 1px solid var(--border);
}
.workbench-copy li:nth-child(even) {
  padding-left: 16px;
}
.workbench-copy li span {
  display: flex;
  flex-direction: column;
}
.workbench-copy li strong {
  color: var(--foreground);
  font-size: 12px;
}
.workbench-copy li small {
  font-size: 9px;
}
.inverse-button {
  align-self: flex-start;
  border-color: var(--foreground) !important;
  background: var(--foreground) !important;
  color: var(--background) !important;
}
.manifest {
  margin: 16px 16px 16px 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--subtle);
  transition:
    background-color 200ms ease,
    border-color 200ms ease;
}
.manifest header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 18px;
  border-bottom: 1px solid var(--border);
  color: var(--muted-foreground);
  font:
    10px ui-monospace,
    monospace;
}
.manifest header span {
  display: flex;
  align-items: center;
  gap: 8px;
}
.manifest header b {
  color: var(--success);
  font-weight: 500;
}
.manifest pre {
  min-height: 238px;
  padding: 32px 26px;
  border-bottom: 1px solid var(--border);
  color: var(--foreground);
  font-size: 12px;
  line-height: 2;
}
.manifest > div {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) 18px;
  align-items: center;
  min-height: 44px;
  margin: 0 18px;
  border-bottom: 1px solid var(--border);
  color: var(--success);
}
.manifest > div span {
  color: var(--muted-foreground);
  font:
    9px ui-monospace,
    monospace;
}
.manifest > div strong {
  color: var(--muted-foreground);
  font:
    500 10px ui-monospace,
    monospace;
}
.starter-strip {
  display: flex;
  min-height: 90px;
  align-items: center;
  justify-content: space-between;
  gap: 30px;
  padding: 18px 24px;
  border: 1px solid var(--border);
  border-top: 0;
  border-radius: 0 0 8px 8px;
  background: var(--background);
  box-shadow: var(--shadow-lg);
}
.starter-strip > div {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 14px;
}
.starter-strip > div > span:last-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.starter-strip strong {
  font-size: 13px;
}
.starter-strip small {
  margin-top: 2px;
  color: var(--muted-foreground);
  font-size: 11px;
}
.starter-play {
  display: grid;
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--subtle);
}
.starter-play :deep(svg) {
  width: 15px;
  height: 15px;
}
.faq-grid {
  display: grid;
  grid-template-columns: 0.65fr 1.35fr;
  gap: 90px;
}
.faq-grid :deep(.ant-collapse) {
  border-top: 1px solid var(--border);
}
.faq-grid :deep(.ant-collapse-header) {
  align-items: center !important;
  min-height: 76px;
  padding-inline: 0 !important;
  font-weight: 600;
}
.faq-grid :deep(.ant-collapse-content-box) {
  padding: 0 0 24px !important;
  color: var(--muted-foreground);
  line-height: 1.75;
}
.final-cta {
  border-block: 1px solid var(--border);
  background: var(--muted);
  color: var(--foreground);
  transition:
    background-color 200ms ease,
    border-color 200ms ease,
    color 200ms ease;
}
.final-cta > div {
  display: flex;
  min-height: 360px;
  align-items: flex-start;
  justify-content: center;
  flex-direction: column;
  gap: 30px;
}
.final-cta .section-kicker {
  color: var(--muted-foreground);
}
.final-cta h2 {
  max-width: 700px;
  font-size: 46px;
}
.site-footer {
  border-top: 1px solid var(--border);
}
.site-footer > div {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  min-height: 110px;
}
.site-footer p,
.site-footer nav a,
.site-footer nav button {
  color: var(--muted-foreground);
  font-size: 12px;
}
.site-footer nav {
  display: flex;
  justify-self: end;
  gap: 22px;
}
.site-footer nav a {
  text-decoration: none;
}
.site-footer nav button {
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.reveal {
  opacity: 0;
  transform: translateY(14px);
  transition:
    opacity 560ms ease,
    transform 560ms ease;
}
.reveal.visible {
  opacity: 1;
  transform: translateY(0);
}

@media (max-width: 900px) {
  .nav-shell {
    grid-template-columns: 1fr auto;
  }
  .nav-links {
    position: absolute;
    top: 63px;
    right: 24px;
    left: 24px;
    display: none;
    align-items: stretch;
    flex-direction: column;
    gap: 0;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--background);
    box-shadow: var(--shadow-xl);
  }
  .nav-links.open {
    display: flex;
  }
  .nav-links a {
    display: flex;
    min-height: 44px;
    align-items: center;
    padding: 0 12px;
    border-radius: 4px;
  }
  .nav-links a:hover {
    background: var(--muted);
  }
  .menu-button {
    display: inline-flex;
  }
  .feature-wide {
    grid-template-columns: 1fr;
  }
  .architecture-grid {
    gap: 54px;
  }
}
@media (max-width: 760px) {
  .nav-shell,
  .section-inner {
    width: calc(100% - 32px);
  }
  .site-header {
    height: 58px;
  }
  .desktop-cta {
    display: none;
  }
  .login-link {
    min-width: 44px;
    min-height: 44px;
    padding-inline: 6px;
  }
  .nav-actions :deep(.ant-btn-circle),
  .menu-button {
    width: 44px;
    min-width: 44px;
    height: 44px;
  }
  .hero {
    padding: 108px 12px 52px;
  }
  .hero h1 {
    font-size: 52px;
  }
  .hero-copy > p {
    font-size: 16px;
  }
  .hero-actions {
    flex-direction: column;
    max-width: 330px;
    margin-inline: auto;
    margin-top: 28px;
  }
  .hero-actions :deep(.ant-btn) {
    width: 100%;
  }
  .landing-page :deep(.ant-btn),
  .text-link {
    min-height: 44px;
  }
  .hero-actions :deep(.ant-btn) {
    min-height: 48px;
  }
  .proof-inner {
    align-items: flex-start;
    flex-direction: column;
    padding: 18px 0;
  }
  .proof-inner > div {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
    gap: 12px;
  }
  .section {
    padding: 80px 0;
  }
  .section-heading h2,
  .architecture-copy h2,
  .offer-intro h2,
  .faq-grid h2,
  .final-cta h2 {
    font-size: 32px;
  }
  .feature-grid,
  .architecture-grid,
  .offer-intro,
  .workbench,
  .faq-grid {
    grid-template-columns: 1fr;
  }
  .feature {
    min-height: 340px;
    padding: 26px;
  }
  .feature-wide {
    min-height: 470px;
  }
  .architecture-copy {
    position: static;
  }
  .offer-intro {
    align-items: start;
    gap: 18px;
  }
  .workbench-copy {
    padding: 34px 28px;
  }
  .manifest {
    margin: 0 16px 16px;
  }
  .starter-strip {
    align-items: stretch;
    flex-direction: column;
    padding: 20px;
  }
  .starter-strip :deep(.ant-btn) {
    width: 100%;
  }
  .faq-grid {
    gap: 44px;
  }
  .final-cta > div {
    min-height: 400px;
    gap: 32px;
  }
  .final-cta .inverse-button {
    width: 100%;
    justify-content: center;
  }
  .site-footer > div {
    grid-template-columns: 1fr;
    justify-items: start;
    gap: 12px;
    padding: 28px 0;
  }
  .site-footer nav {
    justify-self: start;
  }
  .site-footer nav a,
  .site-footer nav button {
    display: inline-flex;
    min-width: 44px;
    min-height: 44px;
    align-items: center;
    justify-content: center;
    padding-inline: 10px;
  }
}
@media (max-width: 430px) {
  .nav-links {
    right: 12px;
    left: 12px;
  }
  .hero h1 {
    font-size: 46px;
  }
  .proof-inner > div {
    grid-template-columns: 1fr;
  }
  .context-visual {
    grid-template-columns: 1fr;
  }
  .workbench-copy {
    padding: 28px 22px;
  }
  .workbench-copy ul {
    grid-template-columns: 1fr;
  }
  .workbench-copy li:nth-child(odd) {
    border-right: 0;
  }
  .workbench-copy li:nth-child(even) {
    padding-left: 0;
  }
  .manifest {
    margin-inline: 10px;
  }
  .manifest pre {
    padding: 24px 18px;
    font-size: 10px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .reveal {
    opacity: 1;
    transform: none;
  }
}
</style>
