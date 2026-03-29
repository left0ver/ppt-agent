# ppt-agent

## 功能

### 前置功能
1. 用户可以上传模板(上传pdf或者pptx的格式，并保存到template目录下，重新命名为template.pdf/.pptx,建议pdf的格式,后台使用soffice来进行格式的转换)，然后输入文本，系统会根据模板生成PPT。

  1.1 首先询问用户的PPT的目标群体，用户的角色，PPT的目的，PPT的风格（商务风，简约风，科技风），PPT的页数等信息 （用户的角色可以存在前端本地，之后便不再询问用户的角色）

  1.2. 用户提供PPT的内容（docx、markdown、pdf等）,用户上传之后可能需要对其重命名并保存在context目录下，使用mineru或者glm-ocr进行解析，解析之后可能需要使用一个agent来对内容进行整理，系统根据内容生成PPT。（agent不再进行资料的搜索的步骤） 

  1.3. 通用模式: 用户输入文本，系统根据文本生成PPT。

2. 可以对用户的输入的文本进行改写（如果用户的输入不够详细的话）  

### PPT生成的步骤

0. 资料收集，如果用户没有提供PPT所需的内容，则需要agent进行资料的收集。
1. 根据用户输入的文本，生成PPT的结构：包含整个PPT的标题以及每一页的标题以及大纲 （PPT的大纲生成）
2. 每一页PPT的内容的生成（PPT的内容策划）
    - 用户有上传文件，则让gemini来检索用户的文件内容来生成每一页的内容
    - 如果没有，则我们可以让grok来进行网络搜索来获取相关的资料来生成每一页的内容

3. 使用内容来让gemini生成一个PPT的初稿（整体的PPT的结果，不需要复杂的效果，比较简单的初稿） （PPT设计师）
  > 如果有模板，则需要根据模板来生成初稿
  > 同样初稿也需要临时保存在本地，用户可以继续地问agent来修改初稿的内容

4. 之后再让AI根据生成的初稿来生成最后的PPT （PPT的最终设计）


## 一些其他的需求

1. 可以对某一页进行修改: 生成的每个ppt的每一页都会保存在本地作为文件（定时删除），用户可以在生成的基础上再对某一页进行修改，agent只需要对某一页进行修改即可（建议只是小修改）
2. 逐页地展示生成的PPT，并且用户可以随时取消生成来避免token的消耗  
3. 支持多种风格，例如卡片式，图文混排式，纯文本式等多种风格的PPT的生成

## 工具
1. [搜索的mcp](https://github.com/GuDaStudio/GrokSearch)，参考这个项目的[提示词](https://deepwiki.com/search/grok_a57b1955-fcd6-40ef-b39c-7aa8d74d65e6?mode=fast)自己实现搜索的功能



## 前端
使用chainlit 或者 streamlit 来实现前端的功能，用户可以在前端上传文件，输入文本，展示生成的PPT等功能

## Reference

1. [应该是目前最强的PPT Agent，附上完整思路分享](https://linux.do/t/topic/1782304)
2. [【使用外部知识降低模型幻觉】让专业的grok干专业的search，让专业的tavily干专业的crawl](https://linux.do/t/topic/1606525)
3. [GrokSearch](https://github.com/GuDaStudio/GrokSearch)

4. [grok无限用](https://linux.do/t/topic/1697476)

##  TODO
- [x] 支持用户提供url来作为ppt内容的来源，这里可以使用travil来fetch对应的网页
- [ ] markdown的文件不解析，只有docx和pdf的文件才使用mineru解析
- [ ] 用户没有提供ppt内容的文档,感觉可以删掉search_ppt_contents这个节点,可以先ai根据主题之类的生成outline,之后再根据outline来使用grok生成每一页的内容。
- [ ] 考虑不同的布局特征：居中型、分栏型、卡片型、大标题型、数据看板型等
- [ ] 去掉用户输入汇报目标和ppt风格,ppt的风格在终稿前进行询问，如果用户上传了PPT模板，则不询问
- [ ] 根据ppt模板来生成终稿
