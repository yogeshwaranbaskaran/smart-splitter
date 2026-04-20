import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import AppWrapper from './AppWrapper.jsx'
import SplitView from './SplitView.jsx'
import GroupView from './GroupView.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppWrapper />} />
        <Route path="/group/:id" element={<GroupView />} />
        <Route path="/split/:id" element={<SplitView />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
)