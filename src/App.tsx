import { Routes, Route } from 'react-router-dom'
import Layout from '@/components/Layout'
import Home from '@/pages/Home'
import Spots from '@/pages/Spots'
import PondDetail from '@/pages/PondDetail'
import PostDetail from '@/pages/PostDetail'
import Checkout from '@/pages/Checkout'
import Tickets from '@/pages/Tickets'
import Favorites from '@/pages/Favorites'
import Notifications from '@/pages/Notifications'
import Review from '@/pages/Review'
import Publish from '@/pages/Publish'
import Shop from '@/pages/Shop'
import Profile from '@/pages/Profile'
import Owner from '@/pages/Owner'
import Moderation from '@/pages/Moderation'
import PondApply from '@/pages/PondApply'
import FollowList from '@/pages/FollowList'
import Terms from '@/pages/Terms'
import Privacy from '@/pages/Privacy'
import Login from "./pages/Login"
import NotFound from "./pages/NotFound"

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="spots" element={<Spots />} />
        <Route path="pond/:id" element={<PondDetail />} />
        <Route path="post/:id" element={<PostDetail />} />
        <Route path="checkout" element={<Checkout />} />
        <Route path="tickets" element={<Tickets />} />
        <Route path="favorites" element={<Favorites />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="review/:orderId" element={<Review />} />
        <Route path="publish" element={<Publish />} />
        <Route path="shop" element={<Shop />} />
        <Route path="me" element={<Profile />} />
        <Route path="me/follows" element={<FollowList />} />
        <Route path="owner" element={<Owner />} />
        <Route path="moderation" element={<Moderation />} />
        <Route path="pond-apply" element={<PondApply />} />
        <Route path="terms" element={<Terms />} />
        <Route path="privacy" element={<Privacy />} />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="/login" element={<Login />} />
    </Routes>
  )
}
