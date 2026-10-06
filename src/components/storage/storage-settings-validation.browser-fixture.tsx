import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { StorageDriveSettingsPanel } from './storage-drive-settings-panel';
import { StorageStudioFileSharing } from './storage-studio-file-inspector';
import type { StorageDriveRow } from './storage-management-types';
import type { StorageManagementController } from './storage-management-controller';
import type { FileInfo } from '../../storage/types';

const drive: StorageDriveRow = { id: 'synthetic-drive', name: 'Synthetic drive', max_size_bytes: 1024,
  max_file_size_bytes: 100, public: 0, allowed_mime_types: '*', owner_id: null };
function Fixture() {
  const [result, setResult] = useState('No mutation');
  const [reject, setReject] = useState(false);
  const [allowPublic, setAllowPublic] = useState(true), [publicDrive, setPublicDrive] = useState(false);
  const [publicFile, setPublicFile] = useState(false), [fileWrites, setFileWrites] = useState(0);
  const selected = { ...drive, public: publicDrive ? 1 : 0 };
  const file: FileInfo = { id:'synthetic-file', driveId:drive.id, name:'Synthetic file.txt', path:'Synthetic file.txt',
    type:'file',mimeType:'text/plain',sizeBytes:10,checksum:null,isPublic:publicFile,metadata:{},createdBy:null,createdAt:1,updatedAt:1 };
  // Only the sharing component's transport-free projection is needed here.
  const sharing = { status:'ready',busy:false,loading:false,selectedDrive:{drive:selected},
    selectedFileAccess:{canAdmin:true,isPublic:publicDrive || publicFile},capabilities:{policy:{allowPublicObjects:allowPublic}},
    operations:{setFileVisibility(_file:FileInfo,next:boolean){setPublicFile(next);setFileWrites(value=>value+1)}} } as unknown as StorageManagementController;
  return <><StorageDriveSettingsPanel drive={selected} allowPublicVisibility={allowPublic} onSave={changes => {
    if (reject) { setResult('Server rejected'); throw new Error('Synthetic rejected settings'); }
    setResult(JSON.stringify(changes));
  }} /><button onClick={() => setReject(true)}>Reject next save</button>
    <button onClick={()=>setAllowPublic(false)}>Disable public policy</button><button onClick={()=>setAllowPublic(true)}>Enable public policy</button>
    <button onClick={()=>setPublicDrive(true)}>Seed public drive</button><button onClick={()=>setPublicDrive(false)}>Seed private drive</button>
    <button onClick={()=>setPublicFile(true)}>Seed public file</button>
    <output aria-label="Save result">{result}</output><section aria-label="File sharing fixture"><StorageStudioFileSharing controller={sharing} file={file}/></section>
    <output aria-label="Visibility writes">{fileWrites}</output></>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
