/* 篇目数据
   每一行是一句；text 里的标点会单独占一格、在写完最后一个字后出现。
   partEnd / poemEnd 用来控制换阕、收尾时的停顿。 */
window.SHUFA_POEMS = [
  {
    id: 'sushi',
    title: '观潮',
    subtitle: '庐山烟雨浙江潮',
    author: '苏轼',
    dynasty: '宋',
    seal: '墨戲',
    lines: [
      { text: '庐山烟雨浙江潮，' },
      { text: '未到千般恨不消。' },
      { text: '到得还来无别事。' },
      { text: '庐山烟雨浙江潮。', poemEnd: true }
    ]
  },
  {
    id: 'libai',
    title: '忆秦娥',
    subtitle: '',
    author: '李白',
    dynasty: '唐',
    seal: '墨戲',
    lines: [
      { text: '箫声咽，' },
      { text: '秦娥梦断秦楼月。' },
      { text: '秦楼月，' },
      { text: '年年柳色，' },
      { text: '灞陵伤别。', partEnd: true },
      { text: '乐游原上清秋节。' },
      { text: '咸阳古道音尘绝。' },
      { text: '音尘绝，' },
      { text: '西风残照，' },
      { text: '汉家陵阙。', poemEnd: true }
    ]
  },
  {
    id: 'mao',
    title: '忆秦娥',
    subtitle: '娄山关',
    author: '毛泽东',
    dynasty: '',
    seal: '墨戲',
    lines: [
      { text: '西风烈，' },
      { text: '长空雁叫霜晨月。' },
      { text: '霜晨月，' },
      { text: '马蹄声碎，' },
      { text: '喇叭声咽。', partEnd: true },
      { text: '雄关漫道真如铁，' },
      { text: '而今迈步从头越。' },
      { text: '从头越，' },
      { text: '苍山如海，' },
      { text: '残阳如血。', poemEnd: true }
    ]
  }
];
