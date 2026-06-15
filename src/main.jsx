import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import AppWrapper from './AppWrapper.jsx'
import SplitView from './SplitView.jsx'
import GroupView from './GroupView.jsx'
import JoinGroup from './JoinGroup.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppWrapper />} />
        <Route path="/group/:id" element={<GroupView />} />
        <Route path="/join/:id" element={<JoinGroup />} />
        <Route path="/split/:id" element={<SplitView />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
)