export const providers={
 gemini:{name:'Google Gemini',model:'gemini-3.8-flash',env:'GEMINI',kind:'gemini',base:'https://generativelanguage.googleapis.com/v1beta',pdf:true},
 anthropic:{name:'Anthropic Claude',model:'claude-sonnet-5-5',env:'ANTHROPIC',kind:'anthropic',base:'https://api.anthropic.com/v1',pdf:true},
 openai:{name:'OpenAI',model:'gpt-4.1',env:'OPENAI',kind:'responses',base:'https://api.openai.com/v1',pdf:true},
 grok:{name:'Grok',model:'grok-4.7',env:'XAI',kind:'responses',base:'https://api.x.ai/v1',pdf:false},
 muse:{name:'Meta Muse',model:'muse-spark-1.3',env:'META',kind:'chat',base:'https://api.meta.ai/v1',pdf:false},
 deepseek:{name:'DeepSeek',model:'deepseek-flash',env:'DEEPSEEK',kind:'chat',base:'https://api.deepseek.com/v1',pdf:false},
 qwen:{name:'Qwen',model:'qwen-vl-max',env:'QWEN',kind:'chat',base:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',pdf:false}
};
export const qwenRegions={international:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',china:'https://dashscope.aliyuncs.com/compatible-mode/v1',us:'https://dashscope-us.aliyuncs.com/compatible-mode/v1'};
export function providerDefinition(id,region='international'){const p=providers[id];if(!p)throw new Error('请选择有效的 AI 提供商');return {...p,base:id==='qwen'?(qwenRegions[region]||qwenRegions.international):p.base};}
