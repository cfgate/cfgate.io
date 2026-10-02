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
    'Manage Cloudflare Tunnel, DNS, and Access with Kubernetes resources. cfgate applies your configuration and keeps it in sync.',
  skip: 'Skip to content',
  nav: 'Main navigation',
  language: 'Language',
  home: 'cfgate home',
  docs: 'Documentation',
  github: 'View on GitHub',
  how: 'How it works',
  eyebrow: 'An open source Kubernetes controller',
  heading: 'Connect your services',
  accent: 'through Cloudflare.',
  intro:
    'Manage tunnels, DNS, and Access with Kubernetes resources. cfgate keeps your Cloudflare configuration in sync as your services change.',
  start: 'Get started',
  explore: 'Explore the project',
  workflow: 'How cfgate works',
  workflowNote: 'You define the configuration; cfgate keeps it in sync.',
  configure: 'Configure',
  configureCopy:
    'Describe tunnels, routes, and DNS records with Kubernetes resources alongside your service configuration.',
  configureTag: 'Configuration you can version in Git',
  secure: 'Secure',
  secureCopy:
    'Choose which routes require Cloudflare Access and attach policies to their applications. Public routes can stay public.',
  secureTag: 'Access protection where you need it',
  deploy: 'Deploy',
  deployCopy:
    'cfgate runs the tunnel connectors and applies your Cloudflare configuration, then reconciles changes over time.',
  deployTag: 'Ongoing configuration management',
  diagramConfig: 'Kubernetes resources describe a tunnel and its routes.',
  diagramSecure: 'An Access policy controls access to a protected route.',
  diagramDeploy: 'cfgate reconciles configuration between Kubernetes and Cloudflare.',
  workflowCaveat:
    'Access protection is opt-in. For strict authentication, enforce it at your origin too.',
  accessGuide: 'Read the protection guide',
  detailLabel: 'Fits your Kubernetes workflow',
  features: [
    {
      title: 'Configuration in Git',
      text: 'Review Cloudflare configuration changes alongside your service manifests using your existing Git workflow.',
      icon: 'branch',
    },
    {
      title: 'Familiar building blocks',
      text: 'Use Gateway API routes, Kubernetes resources, and the deployment tools you already know.',
      icon: 'stack',
    },
    {
      title: 'Built in the open',
      text: 'Read the code, report an issue, or contribute under the Apache 2.0 license.',
      icon: 'github',
    },
  ],
  installLabel: 'Getting started',
  installTitle: 'Connect your first service.',
  installCopy:
    'Install the controller, add your Cloudflare credentials, and connect your first service. The quick start walks you through it.',
  installGuide: 'Installation guide',
  prereq:
    'Requires Kubernetes, Gateway API CRDs, and Cloudflare credentials. See the guide for supported versions and setup.',
  copy: 'Copy command',
  copied: 'Copied',
  copyFailed: 'Select the command to copy it manually',
  terminal: 'Install with Helm',
  community: 'Help improve cfgate.',
  communityCopy:
    'Share your experience, report a bug, or contribute a change. Feedback from real deployments helps guide the project.',
  contribute: 'Contribute',
  issue: 'Open an issue',
  footer: 'Manage Cloudflare from Kubernetes.',
  by: 'A project by',
  license: 'Apache 2.0',
}

const zh: typeof en = {
  description:
    '使用 Kubernetes 资源管理 Cloudflare Tunnel、DNS 和 Access。cfgate 应用配置并持续保持同步。',
  skip: '跳至内容',
  nav: '主导航',
  language: '语言',
  home: 'cfgate 首页',
  docs: '文档',
  github: '在 GitHub 上查看',
  how: '工作方式',
  eyebrow: '开源 Kubernetes 控制器',
  heading: '通过 Cloudflare',
  accent: '连接你的服务。',
  intro:
    '使用 Kubernetes 资源管理隧道、DNS 和 Access。服务发生变化时，cfgate 持续同步 Cloudflare 配置。',
  start: '开始使用',
  explore: '了解项目',
  workflow: 'cfgate 的工作方式',
  workflowNote: '你定义配置，cfgate 持续保持同步。',
  configure: '配置',
  configureCopy: '使用 Kubernetes 资源描述隧道、路由和 DNS 记录，与服务配置一起维护。',
  configureTag: '配置可纳入 Git 版本管理',
  secure: '保护',
  secureCopy: '选择需要 Cloudflare Access 保护的路由，并为对应应用关联策略。公开路由可以保持公开。',
  secureTag: '按需启用 Access 保护',
  deploy: '部署',
  deployCopy: 'cfgate 运行隧道连接器、应用 Cloudflare 配置，并持续协调后续变更。',
  deployTag: '持续管理配置',
  diagramConfig: 'Kubernetes 资源描述隧道及其路由。',
  diagramSecure: 'Access 策略控制受保护路由的访问。',
  diagramDeploy: 'cfgate 在 Kubernetes 与 Cloudflare 之间协调配置。',
  workflowCaveat: 'Access 保护需要显式启用。严格身份验证还应在源站执行。',
  accessGuide: '阅读保护指南',
  detailLabel: '融入你的 Kubernetes 工作流程',
  features: [
    {
      title: '在 Git 中管理配置',
      text: '沿用现有的 Git 工作流程，一起审查 Cloudflare 配置与服务清单的变更。',
      icon: 'branch',
    },
    {
      title: '熟悉的基础组件',
      text: '使用 Gateway API 路由和 Kubernetes 资源，延续现有工具和工作方式。',
      icon: 'stack',
    },
    {
      title: '开放协作',
      text: '阅读源码、反馈问题，或在 Apache 2.0 许可证下贡献代码。',
      icon: 'github',
    },
  ],
  installLabel: '开始使用',
  installTitle: '连接你的第一个服务。',
  installCopy: '安装控制器，添加 Cloudflare 凭据，连接第一个服务。快速入门指南将带你完成每一步。',
  installGuide: '安装指南',
  prereq: '需要 Kubernetes、Gateway API CRD 和 Cloudflare 凭据。支持的版本与配置方法请参阅指南。',
  copy: '复制命令',
  copied: '已复制',
  copyFailed: '请选中命令并手动复制',
  terminal: '使用 Helm 安装',
  community: '一起改进 cfgate。',
  communityCopy: '欢迎分享使用经验、报告问题或提交改进。实际部署中的反馈有助于确定项目方向。',
  contribute: '参与贡献',
  issue: '提交问题',
  footer: '在 Kubernetes 中管理 Cloudflare。',
  by: '项目来自',
  license: 'Apache 2.0',
}

const hi: typeof en = {
  description:
    'Kubernetes संसाधनों से Cloudflare Tunnel, DNS और Access प्रबंधित करें। cfgate आपकी कॉन्फ़िगरेशन लागू करता है और उसे सिंक में रखता है।',
  skip: 'मुख्य सामग्री पर जाएँ',
  nav: 'मुख्य नेविगेशन',
  language: 'भाषा',
  home: 'cfgate होम',
  docs: 'दस्तावेज़',
  github: 'GitHub पर देखें',
  how: 'यह कैसे काम करता है',
  eyebrow: 'एक ओपन सोर्स Kubernetes कंट्रोलर',
  heading: 'अपनी सेवाओं को जोड़ें',
  accent: 'Cloudflare के ज़रिए।',
  intro:
    'Kubernetes संसाधनों से tunnel, DNS और Access प्रबंधित करें। सेवाओं में बदलाव होने पर cfgate आपकी Cloudflare कॉन्फ़िगरेशन को सिंक में रखता है।',
  start: 'शुरू करें',
  explore: 'प्रोजेक्ट देखें',
  workflow: 'cfgate कैसे काम करता है',
  workflowNote: 'आप कॉन्फ़िगरेशन तय करें; cfgate उसे सिंक में रखता है।',
  configure: 'कॉन्फ़िगर करें',
  configureCopy:
    'Kubernetes संसाधनों से tunnel, route और DNS रिकॉर्ड तय करें और उन्हें अपनी सेवा की कॉन्फ़िगरेशन के साथ रखें।',
  configureTag: 'Git में कॉन्फ़िगरेशन का संस्करण नियंत्रण',
  secure: 'सुरक्षित करें',
  secureCopy:
    'चुनें कि किन routes को Cloudflare Access की ज़रूरत है और उनके applications से नीतियाँ जोड़ें। सार्वजनिक routes खुले रह सकते हैं।',
  secureTag: 'जहाँ ज़रूरत हो, वहाँ Access सुरक्षा',
  deploy: 'डिप्लॉय करें',
  deployCopy:
    'cfgate tunnel connectors चलाता है, Cloudflare कॉन्फ़िगरेशन लागू करता है और आगे के बदलावों को सिंक में रखता है।',
  deployTag: 'कॉन्फ़िगरेशन का निरंतर प्रबंधन',
  diagramConfig: 'Kubernetes संसाधन tunnel और उसके routes तय करते हैं।',
  diagramSecure: 'Access नीति सुरक्षित route पर पहुँच नियंत्रित करती है।',
  diagramDeploy: 'cfgate Kubernetes और Cloudflare के बीच कॉन्फ़िगरेशन सिंक करता है।',
  workflowCaveat:
    'Access सुरक्षा को स्पष्ट रूप से सक्षम करना होता है। सख्त प्रमाणीकरण अपने origin पर भी लागू करें।',
  accessGuide: 'सुरक्षा गाइड पढ़ें',
  detailLabel: 'आपके Kubernetes वर्कफ़्लो के साथ',
  features: [
    {
      title: 'Git में कॉन्फ़िगरेशन',
      text: 'अपने मौजूदा Git वर्कफ़्लो में सेवा के manifests और Cloudflare कॉन्फ़िगरेशन के बदलावों की साथ में समीक्षा करें।',
      icon: 'branch',
    },
    {
      title: 'परिचित साधन',
      text: 'Gateway API routes, Kubernetes संसाधनों और अपने जाने-पहचाने डिप्लॉयमेंट टूल का उपयोग करें।',
      icon: 'stack',
    },
    {
      title: 'खुले तौर पर विकसित',
      text: 'कोड पढ़ें, समस्या बताएँ या Apache 2.0 लाइसेंस के तहत योगदान दें।',
      icon: 'github',
    },
  ],
  installLabel: 'शुरुआत',
  installTitle: 'अपनी पहली सेवा कनेक्ट करें।',
  installCopy:
    'कंट्रोलर इंस्टॉल करें, Cloudflare credentials जोड़ें और अपनी पहली सेवा कनेक्ट करें। क्विक स्टार्ट गाइड हर चरण समझाती है।',
  installGuide: 'इंस्टॉलेशन गाइड',
  prereq:
    'Kubernetes, Gateway API CRDs और Cloudflare credentials आवश्यक हैं। समर्थित संस्करण और सेटअप के लिए गाइड देखें।',
  copy: 'कमांड कॉपी करें',
  copied: 'कॉपी हो गया',
  copyFailed: 'कमांड चुनकर स्वयं कॉपी करें',
  terminal: 'Helm से इंस्टॉल करें',
  community: 'cfgate को बेहतर बनाने में मदद करें।',
  communityCopy:
    'अपना अनुभव साझा करें, बग बताएँ या बदलाव में योगदान दें। वास्तविक डिप्लॉयमेंट से मिला फ़ीडबैक प्रोजेक्ट की दिशा तय करने में मदद करता है।',
  contribute: 'योगदान दें',
  issue: 'समस्या दर्ज करें',
  footer: 'Kubernetes से Cloudflare प्रबंधित करें।',
  by: 'एक प्रोजेक्ट',
  license: 'Apache 2.0',
}

export const homeCopy: Record<string, typeof en> = { en, zh, hi }
