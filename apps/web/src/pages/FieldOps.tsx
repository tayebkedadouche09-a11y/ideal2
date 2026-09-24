import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, CardContent, Chip, Grid, MenuItem, Stack, TextField, Typography } from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import StopIcon from '@mui/icons-material/Stop';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { list, uploadCapture, type CaptureItem } from '../api';

type Row=Record<string,unknown>;

export default function FieldOps(){
  const [projects,setProjects]=useState<Row[]>([]);
  const [projectId,setProjectId]=useState('');
  const [captures,setCaptures]=useState<CaptureItem[]>([]);
  const [recording,setRecording]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const recorder=useRef<MediaRecorder|null>(null);
  const chunks=useRef<Blob[]>([]);

  const loadProjects=useCallback(async()=>{try{const r=await list<Row>('/projects');setProjects((Object.values(r).find(v=>Array.isArray(v)) as Row[])??[]);}catch(e){setError(e instanceof Error?e.message:'Erreur');}},[]);
  const loadCaptures=useCallback(async()=>{if(!projectId){setCaptures([]);return;}try{const r=await fetch('/api/v1/projects/'+projectId+'/captures'); if(!r.ok) throw new Error('Impossible de charger les captures'); const d=await r.json() as {captures:CaptureItem[]};setCaptures(d.captures);}catch(e){setError(e instanceof Error?e.message:'Erreur');}},[projectId]);
  useEffect(()=>{void loadProjects();},[loadProjects]); useEffect(()=>{void loadCaptures();},[loadCaptures]);

  async function upload(file:File,type:string){
    if(!projectId)return;setBusy(true);setError(null);
    try{await uploadCapture(file,{capture_type:type,project_id:projectId});await loadCaptures();}
    catch(e){setError(e instanceof Error?e.message:'Erreur');}finally{setBusy(false);}
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
      {c.note&&<Typography color="text.secondary">{c.note}</Typography>}
      {c.latitude!=null&&<Typography variant="caption">GPS: {c.latitude}, {c.longitude}</Typography>}
    </CardContent></Card></Grid>)}</Grid>
    {projectId&&captures.length===0&&<Typography color="text.secondary">Aucune capture pour ce chantier.</Typography>}
  </CardContent></Card>;
}
