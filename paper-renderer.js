(function(root){
  'use strict';
  const P=root.PaperPhysics,W=1080,H=990,LEFT=60,TOP=240;
  const VS=`attribute vec3 a_position;attribute vec2 a_uv;attribute vec3 a_normal;
    uniform float u_layer;varying vec2 v_uv;varying vec3 v_normal;
    void main(){vec3 p=a_position;p.z+=u_layer; p.y+=u_layer*.22;
      gl_Position=vec4((p.x+60.0)/1080.0*2.0-1.0,1.0-(p.y-p.z*.24+240.0)/990.0*2.0,-p.z/900.0,1.0);
      v_uv=a_uv;v_normal=a_normal;}`;
  const FS=`precision mediump float;varying vec2 v_uv;varying vec3 v_normal;
    uniform sampler2D u_front;uniform sampler2D u_back;uniform float u_direction;uniform float u_packet;
    void main(){bool front=gl_FrontFacing;float x=u_direction>0.0?v_uv.x:1.0-v_uv.x;
      vec4 paper=front?texture2D(u_front,vec2(x,v_uv.y)):texture2D(u_back,vec2(1.0-x,v_uv.y));
      vec3 n=normalize(v_normal)*(front?1.0:-1.0);float light=max(dot(n,normalize(vec3(-.3,-.32,1.0))),0.0);
      float bend=pow(1.0-abs(n.z),2.0);float shade=.83+.17*light-.045*bend;
      if(u_packet>0.5)paper=vec4(.92,.88,.78,1.0);
      if(min(v_uv.x,1.0-v_uv.x)<.0015||min(v_uv.y,1.0-v_uv.y)<.0012)paper.rgb=mix(paper.rgb,vec3(.97,.94,.86),.65);
      gl_FragColor=vec4(paper.rgb*shade,paper.a);}`;
  function shader(gl,type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
  class Renderer{
    constructor(host,painter){
      this.host=host;this.painter=painter;this.cache=new Map();this.cols=40;this.rows=16;
      this.shadow=document.createElement('canvas');this.shadow.className='paper-curl-shadow';
      this.canvas=document.createElement('canvas');this.canvas.className='paper-curl-canvas';
      for(const c of [this.shadow,this.canvas]){c.setAttribute('aria-hidden','true');host.appendChild(c);}
      this.shadow.width=W;this.shadow.height=H;this.shadowContext=this.shadow.getContext('2d');
      this.pixelRatio=Math.min(root.devicePixelRatio||1,1.75);
      this.canvas.width=Math.round(W*this.pixelRatio);this.canvas.height=Math.round(H*this.pixelRatio);
      let gl;
      try{gl=new URLSearchParams(location.search).get('paperRenderer')==='canvas'?null:this.canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:false,preserveDrawingBuffer:true});if(gl)this.initGL(gl);}catch(e){console.warn('纸页 GPU 不可用，使用曲面 Canvas 回退。',e.message);gl=null;}
      if(!gl){this.canvas.remove();this.canvas=document.createElement('canvas');this.canvas.className='paper-curl-canvas';this.canvas.width=W;this.canvas.height=H;this.canvas.setAttribute('aria-hidden','true');host.appendChild(this.canvas);this.fallback=this.canvas.getContext('2d');this.cols=20;this.rows=8;}
      this.gl=gl;host.dataset.renderer=gl?'webgl-curved-sheet':'canvas-curved-sheet';
      this.triangles=P.indices(this.cols,this.rows);
      if(gl){gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indexBuffer);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,this.triangles,gl.STATIC_DRAW);}
      this.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();if(this.onContextLoss)this.onContextLoss();});
      this.hide();
      document.fonts?.ready.then(()=>this.cache.clear());
    }
    initGL(gl){
      const program=gl.createProgram();gl.attachShader(program,shader(gl,gl.VERTEX_SHADER,VS));gl.attachShader(program,shader(gl,gl.FRAGMENT_SHADER,FS));gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
      this.program=program;gl.useProgram(program);this.buffer=gl.createBuffer();this.indexBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
      [['a_position',3,0],['a_uv',2,12],['a_normal',3,20]].forEach(([name,size,offset])=>{const a=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,size,gl.FLOAT,false,32,offset);});
      this.uniforms={};['u_front','u_back','u_direction','u_layer','u_packet'].forEach(n=>this.uniforms[n]=gl.getUniformLocation(program,n));
      this.textures=[gl.createTexture(),gl.createTexture()];
      gl.uniform1i(this.uniforms.u_front,0);gl.uniform1i(this.uniforms.u_back,1);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.clearColor(0,0,0,0);
    }
    page(index){
      if(this.cache.has(index))return this.cache.get(index);
      const c=document.createElement('canvas'),ratio=2;c.width=480*ratio;c.height=704*ratio;
      this.painter(c,index,ratio);this.cache.set(index,c);
      if(this.cache.size>6)this.cache.delete(this.cache.keys().next().value);
      return c;
    }
    prepare(front,back,direction,count=1){
      this.direction=direction;this.count=count;this.images=[this.page(front),this.page(back)];
      const gl=this.gl;
      if(gl){gl.useProgram(this.program);this.images.forEach((image,i)=>{
        gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,this.textures[i]);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
      });gl.frontFace(direction>0?gl.CW:gl.CCW);gl.uniform1f(this.uniforms.u_direction,direction);}
      this.canvas.hidden=false;this.shadow.hidden=false;
    }
    draw(options){
      const shape=P.mesh({...options,direction:this.direction},this.cols,this.rows);this.lastShape=shape;
      this.drawShadow(shape,options.progress);
      if(this.gl){
        const gl=this.gl;gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
        gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,shape.vertices,gl.DYNAMIC_DRAW);
        gl.uniform1f(this.uniforms.u_packet,1);
        const layers=Math.min(4,this.count-1);
        for(let i=layers;i>=1;i--){gl.uniform1f(this.uniforms.u_layer,-i*1.7);gl.drawElements(gl.TRIANGLES,this.triangles.length,gl.UNSIGNED_SHORT,0);}
        gl.uniform1f(this.uniforms.u_packet,0);gl.uniform1f(this.uniforms.u_layer,0);gl.drawElements(gl.TRIANGLES,this.triangles.length,gl.UNSIGNED_SHORT,0);
      }else this.drawFallback(shape);
      this.host.dataset.curlProgress=options.progress.toFixed(4);this.host.dataset.curlHeight=shape.maxZ.toFixed(2);
    }
    drawShadow(shape,p){
      const ctx=this.shadowContext,a=shape.vertices,c=shape.cols,r=shape.rows;
      ctx.clearRect(0,0,W,H);if(p<=0||p>=1)return;
      const outline=[];
      for(let i=0;i<=c;i++)outline.push(i);
      for(let j=1;j<=r;j++)outline.push(j*(c+1)+c);
      for(let i=c-1;i>=0;i--)outline.push(r*(c+1)+i);
      for(let j=r-1;j>0;j--)outline.push(j*(c+1));
      ctx.save();ctx.translate(LEFT,TOP);ctx.beginPath();
      outline.forEach((i,n)=>{const k=i*8,px=a[k]+a[k+2]*.17,py=a[k+1]+a[k+2]*.09;n?ctx.lineTo(px,py):ctx.moveTo(px,py);});ctx.closePath();
      const alpha=.1+Math.sin(Math.PI*p)*.12;ctx.fillStyle=`rgba(43,34,19,${alpha})`;
      ctx.shadowColor=`rgba(39,29,15,${alpha+.05})`;ctx.shadowBlur=8+Math.min(26,shape.maxZ*.1);ctx.shadowOffsetY=5;ctx.fill();ctx.restore();
    }
    drawFallback(shape){
      const ctx=this.fallback,a=shape.vertices,idx=this.triangles;ctx.clearRect(0,0,W,H);
      const tris=[];
      for(let k=0;k<idx.length;k+=3){const ids=[idx[k],idx[k+1],idx[k+2]];tris.push({ids,z:ids.reduce((s,i)=>s+a[i*8+2],0)/3});}
      tris.sort((a,b)=>a.z-b.z);
      for(const {ids} of tris){
        const pts=ids.map(i=>{const k=i*8;return {x:a[k]+LEFT,y:a[k+1]-a[k+2]*P.SLOPE+TOP,u:a[k+3],v:a[k+4],n:a[k+7]};});
        const front=pts.reduce((s,p)=>s+p.n,0)>=0,image=this.images[front?0:1];
        const from=pts.map(p=>({x:((this.direction>0)===front?p.u:1-p.u)*image.width,y:p.v*image.height}));
        this.triangle(ctx,image,from,pts);
      }
    }
    triangle(ctx,image,s,d){
      const [p,q,r]=s,[a,b,c]=d,det=p.x*(q.y-r.y)+q.x*(r.y-p.y)+r.x*(p.y-q.y);if(Math.abs(det)<.001)return;
      const coeff=(v1,v2,v3)=>[(v1*(q.y-r.y)+v2*(r.y-p.y)+v3*(p.y-q.y))/det,(v1*(r.x-q.x)+v2*(p.x-r.x)+v3*(q.x-p.x))/det,(v1*(q.x*r.y-r.x*q.y)+v2*(r.x*p.y-p.x*r.y)+v3*(p.x*q.y-q.x*p.y))/det];
      const xx=coeff(a.x,b.x,c.x),yy=coeff(a.y,b.y,c.y);
      const cx=(a.x+b.x+c.x)/3,cy=(a.y+b.y+c.y)/3;
      const expand=p=>{const d=Math.hypot(p.x-cx,p.y-cy)||1;return {x:p.x+(p.x-cx)/d*.28,y:p.y+(p.y-cy)/d*.28};};
      const [aa,bb,cc]=[a,b,c].map(expand);
      ctx.save();ctx.beginPath();ctx.moveTo(aa.x,aa.y);ctx.lineTo(bb.x,bb.y);ctx.lineTo(cc.x,cc.y);ctx.closePath();ctx.clip();ctx.transform(xx[0],yy[0],xx[1],yy[1],xx[2],yy[2]);ctx.drawImage(image,0,0);
      ctx.fillStyle=`rgba(41,34,22,${.035+.12*(1-Math.abs((a.n+b.n+c.n)/3))})`;ctx.fillRect(0,0,image.width,image.height);ctx.restore();
    }
    hide(){this.canvas.hidden=true;this.shadow.hidden=true;delete this.host.dataset.curlProgress;delete this.host.dataset.curlHeight;}
  }
  root.PaperSheetRenderer=Renderer;
})(window);
