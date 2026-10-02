export const links = {
  repository: 'https://github.com/cfgate/cfgate',
  docs: 'https://github.com/cfgate/cfgate#documentation',
  start: 'https://github.com/cfgate/cfgate#quick-start',
  install: 'https://github.com/cfgate/cfgate#getting-started',
  access: 'https://github.com/cfgate/cfgate/blob/main/docs/access-required.md',
  contribute: 'https://github.com/cfgate/cfgate/blob/main/CONTRIBUTING.md',
  issues: 'https://github.com/cfgate/cfgate/issues',
}

export const locales = [
  { code: 'en', label: 'EN', name: 'English', href: '/' },
  { code: 'zh', label: '中文', name: '简体中文', href: '/zh/' },
  { code: 'hi', label: 'हिन्दी', name: 'हिन्दी', href: '/hi/' },
]

const en = {
  description:
    'Manage Cloudflare Tunnel, DNS, and Access from Kubernetes. Declare your configuration. Let cfgate keep it in sync.',
  skip: 'Skip to content',
  nav: 'Main navigation',
  language: 'Language',
  home: 'cfgate home',
  docs: 'Documentation',
  github: 'View on GitHub',
  how: 'How it works',
  eyebrow: 'Open source. Kubernetes native.',
  heading: 'Your cluster.',
  accent: 'Connected to the world.',
  intro:
    'Tunnels, DNS, and Access. Defined in Kubernetes, managed by cfgate. A little YAML. A lot less dashboard.',
  start: 'Get started',
  explore: 'Explore the project',
  workflow: 'From intent to infrastructure',
  workflowNote: 'You declare it. cfgate takes it from there.',
  configure: 'Configure',
  configureCopy:
    'Give your services a way out. Describe tunnels, routes, and DNS with familiar Kubernetes resources.',
  configureTag: 'Your configuration, in Git',
  secure: 'Secure',
  secureCopy:
    'Decide who gets in. Attach Cloudflare Access policies where you need them, and keep public routes public.',
  secureTag: 'Protection, on your terms',
  deploy: 'Deploy',
  deployCopy:
    'Let the controller do the work. cfgate applies your Cloudflare configuration and keeps reconciling as things change.',
  deployTag: 'Always working toward your intent',
  diagramConfig: 'Kubernetes resources describe a tunnel and its routes.',
  diagramSecure: 'An Access policy controls access to a protected route.',
  diagramDeploy: 'cfgate reconciles configuration between Kubernetes and Cloudflare.',
  workflowCaveat:
    'Access protection is opt-in. For strict authentication, enforce it at your origin too.',
  accessGuide: 'Read the protection guide',
  detailLabel: 'Less glue. More control.',
  features: [
    {
      title: 'One source of truth',
      text: 'Review changes in Git. Keep Cloudflare configuration alongside the services it belongs to.',
      icon: 'branch',
    },
    {
      title: 'Familiar building blocks',
      text: 'Use Gateway API routes and Kubernetes resources. Work with the tools you already know.',
      icon: 'stack',
    },
    {
      title: 'Built in the open',
      text: 'Apache 2.0 licensed. Read the code, report an issue, or help shape what comes next.',
      icon: 'github',
    },
  ],
  installLabel: 'Make the connection',
  installTitle: 'Your next deploy can be simpler.',
  installCopy:
    'Install the controller, add your Cloudflare credentials, and connect your first service. The quick start walks you through it.',
  installGuide: 'Installation guide',
  prereq:
    'Requires Kubernetes, Gateway API CRDs, and Cloudflare credentials. See the guide for supported versions and setup.',
  copy: 'Copy command',
  copied: 'Copied',
  copyFailed: 'Select the command to copy it manually',
  terminal: 'Install with Helm',
  community: 'Good infrastructure is a team effort.',
  communityCopy: 'Trying cfgate? Tell us what works, what doesn’t, and what you want to build.',
  contribute: 'Contribute',
  issue: 'Start a conversation',
  footer: 'Cloudflare management, in Kubernetes.',
  by: 'A project by',
  license: 'Apache 2.0',
}

const zh: typeof en = {
  description:
    '在 Kubernetes 中管理 Cloudflare Tunnel、DNS 和 Access。声明配置，让 cfgate 持续保持同步。',
  skip: '跳至内容',
  nav: '主导航',
  language: '语言',
  home: 'cfgate 首页',
  docs: '文档',
  github: '在 GitHub 上查看',
  how: '工作方式',
  eyebrow: '开源。为 Kubernetes 而生。',
  heading: '你的集群。',
  accent: '连接整个世界。',
  intro:
    '在 Kubernetes 中定义 Tunnel、DNS 和 Access，由 cfgate 统一管理。多一点 YAML，少一些控制台操作。',
  start: '开始使用',
  explore: '了解项目',
  workflow: '从声明到基础设施',
  workflowNote: '你声明配置，cfgate 持续执行。',
  configure: '配置',
  configureCopy: '让服务连接外部世界。使用熟悉的 Kubernetes 资源描述隧道、路由和 DNS。',
  configureTag: '配置随代码一起管理',
  secure: '保护',
  secureCopy: '决定谁可以访问。按需关联 Cloudflare Access 策略，让公开路由保持公开。',
  secureTag: '按你的需求配置保护',
  deploy: '部署',
  deployCopy: '把工作交给控制器。cfgate 应用 Cloudflare 配置，并在变化发生时持续协调。',
  deployTag: '持续向期望状态收敛',
  diagramConfig: 'Kubernetes 资源描述隧道及其路由。',
  diagramSecure: 'Access 策略控制受保护路由的访问。',
  diagramDeploy: 'cfgate 在 Kubernetes 与 Cloudflare 之间协调配置。',
  workflowCaveat: 'Access 保护需要显式启用。严格身份验证还应在源站执行。',
  accessGuide: '阅读保护指南',
  detailLabel: '减少繁琐集成，保留控制权。',
  features: [
    {
      title: '统一的配置来源',
      text: '在 Git 中审查变更，让 Cloudflare 配置与对应服务一起维护。',
      icon: 'branch',
    },
    {
      title: '熟悉的基础组件',
      text: '使用 Gateway API 路由和 Kubernetes 资源，延续现有工具和工作方式。',
      icon: 'stack',
    },
    {
      title: '开放协作',
      text: '采用 Apache 2.0 许可证。阅读源码、反馈问题，一起决定项目的下一步。',
      icon: 'github',
    },
  ],
  installLabel: '建立连接',
  installTitle: '让下一次部署更简单。',
  installCopy: '安装控制器，添加 Cloudflare 凭据，连接第一个服务。快速入门指南将带你完成每一步。',
  installGuide: '安装指南',
  prereq: '需要 Kubernetes、Gateway API CRD 和 Cloudflare 凭据。支持的版本与配置方法请参阅指南。',
  copy: '复制命令',
  copied: '已复制',
  copyFailed: '请选中命令并手动复制',
  terminal: '使用 Helm 安装',
  community: '好的基础设施，来自共同努力。',
  communityCopy: '正在试用 cfgate？欢迎分享经验、问题，以及你想构建的应用。',
  contribute: '参与贡献',
  issue: '发起讨论',
  footer: '在 Kubernetes 中管理 Cloudflare。',
  by: '项目来自',
  license: 'Apache 2.0',
}

const hi: typeof en = {
  description:
    'Kubernetes से Cloudflare Tunnel, DNS और Access प्रबंधित करें। कॉन्फ़िगरेशन तय करें और cfgate को उसे सिंक में रखने दें।',
  skip: 'मुख्य सामग्री पर जाएँ',
  nav: 'मुख्य नेविगेशन',
  language: 'भाषा',
  home: 'cfgate होम',
  docs: 'दस्तावेज़',
  github: 'GitHub पर देखें',
  how: 'यह कैसे काम करता है',
  eyebrow: 'ओपन सोर्स। Kubernetes के लिए।',
  heading: 'आपका क्लस्टर।',
  accent: 'दुनिया से जुड़ा हुआ।',
  intro:
    'Tunnel, DNS और Access की कॉन्फ़िगरेशन Kubernetes में रखें, प्रबंधन cfgate पर छोड़ें। थोड़ा YAML, बहुत कम डैशबोर्ड।',
  start: 'शुरू करें',
  explore: 'प्रोजेक्ट देखें',
  workflow: 'कॉन्फ़िगरेशन से इन्फ़्रास्ट्रक्चर तक',
  workflowNote: 'आप तय करें। cfgate आगे का काम संभालेगा।',
  configure: 'कॉन्फ़िगर करें',
  configureCopy:
    'अपनी सेवाओं को बाहर की दुनिया से जोड़ें। परिचित Kubernetes संसाधनों से tunnel, route और DNS तय करें।',
  configureTag: 'आपकी कॉन्फ़िगरेशन, Git में',
  secure: 'सुरक्षित करें',
  secureCopy:
    'तय करें कि किसे पहुँच मिले। जहाँ ज़रूरत हो Cloudflare Access नीतियाँ जोड़ें और सार्वजनिक routes को सार्वजनिक रखें।',
  secureTag: 'सुरक्षा, आपकी ज़रूरत के अनुसार',
  deploy: 'डिप्लॉय करें',
  deployCopy:
    'कंट्रोलर को काम करने दें। cfgate Cloudflare कॉन्फ़िगरेशन लागू करता है और बदलावों के साथ उसे लगातार सिंक में रखता है।',
  deployTag: 'आपकी तय स्थिति की ओर निरंतर काम',
  diagramConfig: 'Kubernetes संसाधन tunnel और उसके routes तय करते हैं।',
  diagramSecure: 'Access नीति सुरक्षित route पर पहुँच नियंत्रित करती है।',
  diagramDeploy: 'cfgate Kubernetes और Cloudflare के बीच कॉन्फ़िगरेशन सिंक करता है।',
  workflowCaveat:
    'Access सुरक्षा को स्पष्ट रूप से सक्षम करना होता है। सख्त प्रमाणीकरण अपने origin पर भी लागू करें।',
  accessGuide: 'सुरक्षा गाइड पढ़ें',
  detailLabel: 'कम जोड़-तोड़। ज़्यादा नियंत्रण।',
  features: [
    {
      title: 'कॉन्फ़िगरेशन का एक स्रोत',
      text: 'Git में बदलावों की समीक्षा करें। Cloudflare कॉन्फ़िगरेशन को संबंधित सेवाओं के साथ रखें।',
      icon: 'branch',
    },
    {
      title: 'परिचित साधन',
      text: 'Gateway API routes और Kubernetes संसाधनों का उपयोग करें। अपने जाने-पहचाने टूल के साथ काम करें।',
      icon: 'stack',
    },
    {
      title: 'खुले तौर पर विकसित',
      text: 'Apache 2.0 लाइसेंस। कोड पढ़ें, समस्या बताएँ या प्रोजेक्ट का भविष्य बनाने में योगदान दें।',
      icon: 'github',
    },
  ],
  installLabel: 'कनेक्शन बनाएँ',
  installTitle: 'अगला डिप्लॉय आसान बनाएँ।',
  installCopy:
    'कंट्रोलर इंस्टॉल करें, Cloudflare credentials जोड़ें और अपनी पहली सेवा कनेक्ट करें। क्विक स्टार्ट गाइड हर चरण समझाती है।',
  installGuide: 'इंस्टॉलेशन गाइड',
  prereq:
    'Kubernetes, Gateway API CRDs और Cloudflare credentials आवश्यक हैं। समर्थित संस्करण और सेटअप के लिए गाइड देखें।',
  copy: 'कमांड कॉपी करें',
  copied: 'कॉपी हो गया',
  copyFailed: 'कमांड चुनकर स्वयं कॉपी करें',
  terminal: 'Helm से इंस्टॉल करें',
  community: 'बेहतर इन्फ़्रास्ट्रक्चर, मिलकर बनता है।',
  communityCopy:
    'cfgate आज़मा रहे हैं? बताएँ क्या अच्छा है, क्या नहीं, और आप क्या बनाना चाहते हैं।',
  contribute: 'योगदान दें',
  issue: 'बातचीत शुरू करें',
  footer: 'Cloudflare का प्रबंधन, Kubernetes में।',
  by: 'एक प्रोजेक्ट',
  license: 'Apache 2.0',
}

export const homeCopy: Record<string, typeof en> = { en, zh, hi }
