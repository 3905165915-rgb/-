<template>
  <el-container class="admin-layout">
    <el-aside width="220px">
      <div class="brand">护老智交</div>
      <el-menu :default-active="$route.path" router class="side-menu">
        <el-menu-item index="/dashboard">工作台</el-menu-item>
        <el-menu-item index="/elders">老人档案</el-menu-item>
        <el-menu-item index="/admission">入住与床位</el-menu-item>
        <el-menu-item index="/assessment">评估</el-menu-item>
        <el-menu-item index="/care-plan">照护计划</el-menu-item>
        <el-menu-item index="/tasks">每日任务</el-menu-item>
        <el-menu-item index="/quality">质检台</el-menu-item>
        <el-menu-item index="/coverage">双向核对</el-menu-item>
        <el-menu-item index="/changes">变化简报</el-menu-item>
        <el-menu-item index="/family">家属沟通</el-menu-item>
        <el-menu-item index="/timeline/elder-305-wang">过程回放</el-menu-item>
        <el-menu-item index="/demo">演示保障</el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="page-header">
        <span>管理端</span>
        <span class="header-actions"><el-tag type="warning">演示数据</el-tag><el-button text @click="logout">退出</el-button></span>
      </el-header>
      <el-main><RouterView /></el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
function logout() {
  localStorage.removeItem('hulao:session')
  router.push('/login')
}
</script>
