import { Routes, Route } from 'react-router-dom'
import Layout from '@/components/Layout'
import Home from '@/pages/Home'
import Spots from '@/pages/Spots'
import PondDetail from '@/pages/PondDetail'
import Checkout from '@/pages/Checkout'
import Tickets from '@/pages/Tickets'
import Review from '@/pages/Review'
import Publish from '@/pages/Publish'
import Shop from '@/pages/Shop'
import Profile from '@/pages/Profile'
import Owner from '@/pages/Owner'
import Login from "./pages/Login"
import NotFound from "./pages/NotFound"

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="spots" element={<Spots />} />
        <Route path="pond/:id" element={<PondDetail />} />
        <Route path="checkout" element={<Checkout />} />
        <Route path="tickets" element={<Tickets />} />
        <Route path="review/:orderId" element={<Review />} />
        <Route path="publish" element={<Publish />} />
        <Route path="shop" element={<Shop />} />
        <Route path="me" element={<Profile />} />
        <Route path="owner" element={<Owner />} />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="/login" element={<Login />} />
    </Routes>
  )
}
