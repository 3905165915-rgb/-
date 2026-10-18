<template>
  <main class="mobile-layout">
    <van-nav-bar title="护老智交" />
    <section class="mobile-content"><RouterView /></section>
    <van-tabbar route>
      <van-tabbar-item replace to="/caregiver" icon="home-o">工作台</van-tabbar-item>
      <van-tabbar-item replace to="/records/new" icon="edit">快速记录</van-tabbar-item>
      <van-tabbar-item replace to="/handover" icon="todo-list-o">交接班</van-tabbar-item>
      <van-tabbar-item replace to="/family" icon="chat-o">家属</van-tabbar-item>
    </van-tabbar>
  </main>
</template>
