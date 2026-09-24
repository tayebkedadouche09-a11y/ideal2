import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { createKnowledge, deleteKnowledge, fetchKnowledge, list, type KnowledgeItem } from '../api';

type Row=Record<string,unknown>;
export default function CompanyMemory(){
 const [items,setItems]=useState<KnowledgeItem[]>([]);const [projects,setProjects]=useState<Row[]>([]);
 const [open,setOpen]=useState(false);const [form,setForm]=useState({title:'',content:'',kind:'lesson',project_id:''});const [error,setError]=useState<string|null>(null);
 const load=useCallback(async()=>{try{const [k,p]=await Promise.all([fetchKnowledge(),list<Row>('/projects')]);setItems(k.items);setProjects((Object.values(p).find(v=>Array.isArray(v)) as Row[])??[]);}catch(e){setError(e instanceof Error?e.message:'Erreur');}},[]);
 useEffect(()=>{void load();},[load]);
 async function save(){try{await createKnowledge(form);setOpen(false);setForm({title:'',content:'',kind:'lesson',project_id:''});await load();}catch(e){setError(e instanceof Error?e.message:'Erreur');}}
 async function remove(id:string){try{await deleteKnowledge(id);await load();}catch(e){setError(e instanceof Error?e.message:'Erreur');}}
 return <Card><CardContent>
  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{mb:2}}><div><Typography variant="h6">Company Memory</Typography><Typography color="text.secondary">Mémoire opérationnelle durable : leçons, procédures, solutions et connaissances.</Typography></div><Button variant="contained" onClick={()=>setOpen(true)}>+ Ajouter</Button></Stack>
  {error&&<Alert severity="error" sx={{mb:2}}>{error}</Alert>}
  {items.map(i=><Card variant="outlined" sx={{mb:1}} key={i.id}><CardContent>
   <Stack direction="row" spacing={1} alignItems="center"><Typography variant="subtitle1" sx={{flexGrow:1}}>{i.title}</Typography><Typography variant="caption">{i.kind}</Typography><Button size="small" color="error" onClick={()=>void remove(i.id)}>Supprimer</Button></Stack>
   <Typography sx={{whiteSpace:'pre-wrap'}}>{i.content}</Typography>
   {i.project_id&&<Typography variant="caption" color="text.secondary">Projet lié: {String(projects.find(p=>String(p.id)===i.project_id)?.code??i.project_id)}</Typography>}
  </CardContent></Card>)}
  {items.length===0&&<Typography color="text.secondary">La mémoire est vide. Ajoutez la première leçon ou procédure.</Typography>}
  <Dialog open={open} onClose={()=>setOpen(false)} fullWidth maxWidth="sm"><DialogTitle>Nouvelle connaissance</DialogTitle><DialogContent>
   <TextField fullWidth label="Titre" margin="dense" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/>
   <TextField select fullWidth label="Type" margin="dense" value={form.kind} onChange={e=>setForm({...form,kind:e.target.value})}>{['lesson','procedure','supplier','material','project','incident','solution','general'].map(x=><MenuItem key={x} value={x}>{x}</MenuItem>)}</TextField>
   <TextField select fullWidth label="Projet (optionnel)" margin="dense" value={form.project_id} onChange={e=>setForm({...form,project_id:e.target.value})}><MenuItem value="">Aucun</MenuItem>{projects.map(p=><MenuItem key={String(p.id)} value={String(p.id)}>{String(p.code)} — {String(p.name)}</MenuItem>)}</TextField>
   <TextField fullWidth multiline minRows={5} label="Contenu" margin="dense" value={form.content} onChange={e=>setForm({...form,content:e.target.value})}/>
  </DialogContent><DialogActions><Button onClick={()=>setOpen(false)}>Annuler</Button><Button variant="contained" onClick={()=>void save()} disabled={!form.title||!form.content}>Enregistrer</Button></DialogActions></Dialog>
 </CardContent></Card>;
}
