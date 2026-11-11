/* A reversible, spine-bound flexible sheet. Geometry is in book coordinates.
 * Circular-arc buckling preserves material length along each transverse row.
 * This is a lightweight visual paper model, not a full cloth/FEM simulation. */
(function(root){
  'use strict';
  const WIDTH=480,HEIGHT=704,SLOPE=.24;
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  function halfArc(ratio){
    if(ratio>.999999)return 0;
    let lo=0,hi=1.6;
    for(let i=0;i<20;i++){const m=(lo+hi)/2;if(Math.sin(m)/m>ratio)lo=m;else hi=m;}
    return (lo+hi)/2;
  }
  function rowParameters(progress,grabY,vertical,rowY,radius){
    const p=clamp(progress,0,1),theta=Math.acos(1-2*p);
    const twist=clamp(vertical/360,-.22,.22);
    const angle=clamp(theta+Math.sin(theta)*(rowY-grabY)/HEIGHT*twist,0,Math.PI);
    const lift=.92-.08*Math.sin(angle)**2;
    const q=radius*Math.cos(angle),z=radius*lift*Math.sin(angle),chord=Math.hypot(q,z);
    const a=halfArc(chord/radius);
    return {ex:q/chord,ez:z/chord,a,R:a?radius/(2*a):0,q,z,theta:angle};
  }
  function rowPoint(s,row,params,radius,vertical){
    const {ex,ez,a,R}=params;
    let px,pz,tx,tz;
    if(a<1e-6){px=s*ex;pz=s*ez;tx=ex;tz=ez;}
    else{
      const t=Math.min(s,radius)/radius,phi=(2*t-1)*a;
      const along=R*(Math.sin(phi)+Math.sin(a)),rise=R*(Math.cos(phi)-Math.cos(a));
      px=ex*along-ez*rise;pz=ez*along+ex*rise;
      tx=ex*Math.cos(phi)+ez*Math.sin(phi);tz=ez*Math.cos(phi)-ex*Math.sin(phi);
      if(s>radius){px+=(s-radius)*tx;pz+=(s-radius)*tz;}
    }
    // Projection compensation keeps the selected material point beneath the finger.
    const influence=Math.sin(Math.min(s/radius,1)*Math.PI/2);
    const py=row+(vertical+params.z*SLOPE)*influence;
    return {x:px,y:py,z:Math.max(0,pz),tx,tz};
  }
  function point(options,s,rowY){
    const radius=clamp(options.radius??360,12,WIDTH),vertical=options.vertical||0;
    const row=rowParameters(options.progress,options.grabY??352,vertical,rowY,radius);
    const pt=rowPoint(s,rowY,row,radius,vertical),dir=options.direction||1;
    return {x:480+dir*pt.x,y:pt.y,z:pt.z,nx:-dir*pt.tz,ny:0,nz:pt.tx};
  }
  function mesh(options,cols=40,rows=16){
    const vertices=new Float32Array((cols+1)*(rows+1)*8);
    const radius=clamp(options.radius??360,12,WIDTH),vertical=options.vertical||0,dir=options.direction||1;
    let offset=0,maxZ=0;
    for(let j=0;j<=rows;j++){
      const y=j/rows*HEIGHT,row=rowParameters(options.progress,options.grabY??352,vertical,y,radius);
      for(let i=0;i<=cols;i++){
        const u=i/cols,pt=rowPoint(u*WIDTH,y,row,radius,vertical);
        vertices.set([480+dir*pt.x,pt.y,pt.z,u,j/rows,-dir*pt.tz,0,pt.tx],offset);offset+=8;
        maxZ=Math.max(maxZ,pt.z);
      }
    }
    return {vertices,cols,rows,maxZ};
  }
  function indices(cols=40,rows=16){
    const out=new Uint16Array(cols*rows*6);let k=0;
    for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
      const a=j*(cols+1)+i,b=a+1,c=a+cols+1,d=c+1;
      out.set([a,b,c,b,d,c],k);k+=6;
    }
    return out;
  }
  function release(progress,velocity,cancelled=false){
    if(cancelled||progress<.06)return false;
    if(velocity<-.38)return false;
    return progress>.5||(progress>.13&&velocity>.7);
  }
  function spring(position,velocity,target,dt){
    dt=clamp(dt,0,.024);
    velocity+=((target-position)*145-velocity*24)*dt;
    position=clamp(position+velocity*dt,0,1);
    return {position,velocity,done:Math.abs(position-target)<.0008&&Math.abs(velocity)<.015};
  }
  const api={WIDTH,HEIGHT,SLOPE,point,mesh,indices,release,spring};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PaperPhysics=api;
})(typeof window!=='undefined'?window:globalThis);
