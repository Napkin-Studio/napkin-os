import json,re,os
R='/home/batunii/Documents/Code/napkin-wt-t-ux/app/templates/'
here=os.path.dirname(os.path.abspath(__file__))
html=open(R+'territories/index.html').read()
# drop the real page's main script (the last <script>...</script>) and replace it with the redesign
i=html.rfind('<script>\n(function () {\n  \'use strict\';\n  var L = TerritoriesLogic')
assert i>0
html=html[:i]+'</body>\n</html>\n'
sph=''.join(open(R+'shared/agent-sphere/'+f).read()+'\n' for f in ['finish.js','scene.js','agent-view.js','extra.js','roles.js'])
html=html.replace('<!-- @napkin:agent-sphere -->','<script>\n'+sph+'</script>')
sc=open(R+'shared/source-card.html').read()
html=html.replace('<!-- @napkin:source-card -->',sc)
data=json.load(open(here+'/../live-data.json'))['data']
inj='<script>window.__CLAN__={data:'+json.dumps(data)+',manifest:{title:"Lunasa routes"}};</script>'
css='<style>\n'+open(here+'/src/design.css').read()+'\n</style>'
js='<script>\n'+open(here+'/src/design.js').read()+'\n</script>'
html=html.replace('</head>',css+'</head>',1)
html=html.replace('<div id="app"></div>','<div id="app"></div>'+inj,1)
html=html.replace('</body>',js+'</body>')
open(here+'/index.html','w').write(html)
print(len(html))
