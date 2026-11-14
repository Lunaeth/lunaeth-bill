// Convert PDFs locally for providers whose vision endpoints accept images only.
export async function prepareImages(files,{pdf=true,webp=true}={}){
 if(files.every(f=>(pdf||f.mime!=='application/pdf')&&(webp||f.mime!=='image/webp')))return files;
 const {createCanvas,loadImage,DOMMatrix,Path2D,ImageData}=await import('@napi-rs/canvas');
 globalThis.DOMMatrix??=DOMMatrix;globalThis.Path2D??=Path2D;globalThis.ImageData??=ImageData;
 const result=[];
 for(const f of files){
  if(f.mime==='application/pdf'&&!pdf){
   const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
   const task=getDocument({data:new Uint8Array(f.bytes),isEvalSupported:false,useSystemFonts:true,disableFontFace:true});
   try{const doc=await task.promise;if(doc.numPages>5||result.length+doc.numPages>10)throw new Error('PDF 最多五页，请拆分后重试');
    for(let n=1;n<=doc.numPages;n++){const page=await doc.getPage(n),base=page.getViewport({scale:1}),scale=Math.min(2,2400/Math.max(base.width,base.height));const viewport=page.getViewport({scale});const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;result.push({mime:'image/png',bytes:canvas.toBuffer('image/png')});page.cleanup();}
   }finally{await task.destroy();}
  }else if(f.mime==='image/webp'&&!webp){const img=await loadImage(f.bytes);if(img.width*img.height>30000000)throw new Error('图片尺寸过大，请缩小后重试');const canvas=createCanvas(img.width,img.height);canvas.getContext('2d').drawImage(img,0,0);result.push({mime:'image/png',bytes:canvas.toBuffer('image/png')});}
  else result.push(f);
 }
 if(result.reduce((n,f)=>n+f.bytes.length,0)>30*1024*1024)throw new Error('转换后图片过大，请减少页数');return result;
}
