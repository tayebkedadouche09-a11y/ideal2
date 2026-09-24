import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, CardContent, Chip, Grid, MenuItem, Stack, TextField, Typography } from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import StopIcon from '@mui/icons-material/Stop';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { api, list, uploadCapture, fetchProjectCaptures, fetchCaptureBlob, type CaptureItem } from '../api';

type Row=Record<string,unknown>;

export default function FieldOps(){
  const [projects,setProjects]=useState<Row[]>([]);
  const [projectId,setProjectId]=useState('');
  const [captures,setCaptures]=useState<CaptureItem[]>([]); const [mediaUrls,setMediaUrls]=useState<Record<string,string>>({});
  const [recording,setRecording]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [online,setOnline]=useState(navigator.onLine);
  const [emergencyNote,setEmergencyNote]=useState('');
  const [queued,setQueued]=useState(0);
  const queueKey='cos.field.emergency.v2';
  const recorder=useRef<MediaRecorder|null>(null);
  const chunks=useRef<Blob[]>([]);

  const loadProjects=useCallback(async()=>{try{const r=await list<Row>('/projects');setProjects((Object.values(r).find(v=>Array.isArray(v)) as Row[])??[]);}catch(e){setError(e instanceof Error?e.message:'Erreur');}},[]);
  const loadCaptures=useCallback(async()=>{if(!projectId){setCaptures([]);return;}try{const d=await fetchProjectCaptures(projectId);setCaptures(d.captures);}catch(e){setError(e instanceof Error?e.message:'Erreur');}},[projectId]);
  useEffect(()=>{void loadProjects();},[loadProjects]); useEffect(()=>{void loadCaptures();},[loadCaptures]);
  useEffect(()=>{setQueued(JSON.parse(localStorage.getItem(queueKey)||'[]').length);const on=()=>setOnline(true),off=()=>setOnline(false);window.addEventListener('online',on);window.addEventListener('offline',off);return()=>{window.removeEventListener('online',on);window.removeEventListener('offline',off);};},[]);

  async function preview(id:string){try{const blob=await fetchCaptureBlob(id);setMediaUrls(v=>({...v,[id]:URL.createObjectURL(blob)}));}catch(e){setError(e instanceof Error?e.message:'Impossible de lire la capture');}}
  async function upload(file:File,type:string){
    if(!projectId)return;setBusy(true);setError(null);
    try{let position:GeolocationPosition|null=null; if(navigator.geolocation) position=await new Promise<GeolocationPosition|null>(resolve=>navigator.geolocation.getCurrentPosition(resolve,()=>resolve(null),{enableHighAccuracy:true,timeout:5000})); await uploadCapture(file,{capture_type:type,project_id:projectId,latitude:position?.coords.latitude,longitude:position?.coords.longitude});await loadCaptures();}
    catch(e){setError(e instanceof Error?e.message:'Erreur');}finally{setBusy(false);}
  }
  async function syncEmergencyQueue(){
    if(!navigator.onLine)return;
    const q=JSON.parse(localStorage.getItem(queueKey)||'[]') as {projectId:string;title:string;description:string;severity:string;latitude?:number;longitude?:number}[];
    if(!q.length)return;
    const rest=q.slice();
    for(let i=rest.length-1;i>=0;i--){try{await api(`/projects/${rest[i].projectId}/incidents`,{method:'POST',body:JSON.stringify(rest[i])});rest.splice(i,1);}catch{ /* keep queued */ }}
    localStorage.setItem(queueKey,JSON.stringify(rest));setQueued(rest.length);
  }
  useEffect(()=>{if(online)void syncEmergencyQueue();},[online]);
  useEffect(()=>{const onBefore=()=>{if(recorder.current?.state==='recording')recorder.current.stop();};window.addEventListener('beforeunload',onBefore);return()=>window.removeEventListener('beforeunload',onBefore);},[]);

  async function createEmergency(){
    if(!projectId||!emergencyNote.trim())return;
    let pos:GeolocationPosition|null=null;if(navigator.geolocation)pos=await new Promise<GeolocationPosition|null>(r=>navigator.geolocation.getCurrentPosition(r,()=>r(null),{enableHighAccuracy:true,timeout:4000}));
    const item={projectId,title:'Emergency field report',description:emergencyNote.trim(),severity:'critical',latitude:pos?.coords.latitude,longitude:pos?.coords.longitude};
    if(!navigator.onLine){const q=JSON.parse(localStorage.getItem('cos.field.queue')||'[]');q.push(item);localStorage.setItem(queueKey,JSON.stringify(q));setQueued(q.length);setEmergencyNote('');return;}
    try{await api(`/projects/${projectId}/incidents`,{method:'POST',body:JSON.stringify(item)});setEmergencyNote('');}
    catch{const q=JSON.parse(localStorage.getItem('cos.field.queue')||'[]');q.push(item);localStorage.setItem('cos.field.queue',JSON.stringify(q));setQueued(q.length);}
  }
  async function startVoice(){
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){setError('Voice-to-Work n’est pas supporté par ce navigateur.');return;}
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      const mime=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(x=>MediaRecorder.isTypeSupported(x))??'';
      const mr=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);chunks.current=[];
      mr.ondataavailable=e=>{if(e.data.size)chunks.current.push(e.data);};
      mr.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());const blob=new Blob(chunks.current,{type:mr.mimeType||'audio/webm'});const ext=blob.type.includes('mp4')?'m4a':'webm';await upload(new File([blob],`voice-${Date.now()}.${ext}`,{type:blob.type}),'voice');setRecording(false);};
      recorder.current=mr;mr.start();setRecording(true);
    }catch(e){setError(e instanceof Error?e.message:'Microphone inaccessible');}
  }
  function stopVoice(){recorder.current?.stop();recorder.current=null;}

  return <Card><CardContent>
    <Typography variant="h6" gutterBottom>Field Operations — Universal Capture</Typography>
    <Typography color="text.secondary" sx={{mb:2}}>Photo • Voice-to-Work • documents • captures terrain liées au chantier.</Typography>
    <Stack direction={{xs:'column',md:'row'}} spacing={1} sx={{mb:2}}><Chip color={online?'success':'warning'} label={online?'Online':'Offline'} /><Chip label={`Emergency queue: ${queued}`} /></Stack>
    <Card variant="outlined" sx={{mb:2}}><CardContent><Typography variant="subtitle1">Emergency Mode</Typography><TextField fullWidth multiline minRows={2} label="Incident / urgence" value={emergencyNote} onChange={e=>setEmergencyNote(e.target.value)} sx={{my:1}}/><Button color="error" variant="contained" disabled={!projectId||!emergencyNote.trim()} onClick={()=>void createEmergency()}>Enregistrer l'urgence</Button></CardContent></Card>
    {error&&<Alert severity="error" sx={{mb:2}}>{error}</Alert>}
    <TextField select label="Chantier" fullWidth value={projectId} onChange={e=>setProjectId(e.target.value)} sx={{mb:2}}>
      {projects.map(p=><MenuItem key={String(p.id)} value={String(p.id)}>{String(p.code)} — {String(p.name)}</MenuItem>)}
    </TextField>
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{mb:3}}>
      {!recording?<Button variant="contained" startIcon={<MicIcon/>} disabled={!projectId||busy} onClick={startVoice}>Voice-to-Work</Button>:<Button color="error" variant="contained" startIcon={<StopIcon/>} onClick={stopVoice}>Arrêter</Button>}
      <Button component="label" variant="outlined" startIcon={<PhotoCameraIcon/>} disabled={!projectId||busy}>Photo<input hidden accept="image/*" capture="environment" type="file" onChange={e=>{const f=e.target.files?.[0];if(f)void upload(f,'photo');e.currentTarget.value='';}}/></Button>
      <Button component="label" variant="outlined" startIcon={<UploadFileIcon/>} disabled={!projectId||busy}>Document<input hidden type="file" onChange={e=>{const f=e.target.files?.[0];if(f)void upload(f,'document');e.currentTarget.value='';}}/></Button>
    </Stack>
    <Typography variant="subtitle1" gutterBottom>Timeline des captures</Typography>
    <Grid container spacing={1}>{captures.map(c=><Grid item xs={12} md={6} key={c.id}><Card variant="outlined"><CardContent>
      <Stack direction="row" spacing={1} alignItems="center"><Chip size="small" label={c.capture_type}/><Typography variant="body2">{new Date(c.created_at).toLocaleString()}</Typography></Stack>
      <Typography variant="body2" sx={{mt:1}}>{c.file_name??c.title??'Capture'}</Typography>
      {(c.capture_type==='voice'||c.capture_type==='photo'||c.capture_type==='video')&&<Button size="small" onClick={()=>void preview(c.id)}>{mediaUrls[c.id]?'Masquer':'Ouvrir'}</Button>}
      {mediaUrls[c.id]&&c.capture_type==='voice'&&<audio controls src={mediaUrls[c.id]} style={{width:'100%',marginTop:8}}/>}
      {mediaUrls[c.id]&&c.capture_type==='photo'&&<img src={mediaUrls[c.id]} alt="Capture terrain" style={{width:'100%',maxHeight:260,objectFit:'contain',marginTop:8}}/>}
      {mediaUrls[c.id]&&c.capture_type==='video'&&<video controls src={mediaUrls[c.id]} style={{width:'100%',maxHeight:260,marginTop:8}}/>}
      {c.note&&<Typography color="text.secondary">{c.note}</Typography>}
      {c.latitude!=null&&<Typography variant="caption">GPS: {c.latitude}, {c.longitude}</Typography>}
    </CardContent></Card></Grid>)}</Grid>
    {projectId&&captures.length===0&&<Typography color="text.secondary">Aucune capture pour ce chantier.</Typography>}
  </CardContent></Card>;
}
