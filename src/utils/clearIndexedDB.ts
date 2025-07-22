/**
 * 清理 IndexedDB 数据库的工具函数
 * 用于解决数据库版本冲突问题
 */

/**
 * 删除指定名称的 IndexedDB 数据库
 * @param dbName 数据库名称
 */
export const deleteDatabase = async (dbName: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const deleteRequest = indexedDB.deleteDatabase(dbName);
    
    deleteRequest.onsuccess = () => {
      console.log(`数据库 ${dbName} 已成功删除`);
      resolve();
    };
    
    deleteRequest.onerror = () => {
      console.error(`删除数据库 ${dbName} 失败:`, deleteRequest.error);
      reject(deleteRequest.error);
    };
    
    deleteRequest.onblocked = () => {
      console.warn(`删除数据库 ${dbName} 被阻塞，请关闭所有使用该数据库的标签页`);
      // 可以选择继续等待或者拒绝
      setTimeout(() => {
        reject(new Error('数据库删除被阻塞'));
      }, 5000);
    };
  });
};

/**
 * 清理所有相关的 IndexedDB 数据库
 */
export const clearAllDatabases = async (): Promise<void> => {
  const databasesToClear = [
    'fileDownloadTest',
    'fileUploadTest',
    'localforage'
  ];
  
  for (const dbName of databasesToClear) {
    try {
      await deleteDatabase(dbName);
    } catch (error) {
      console.error(`清理数据库 ${dbName} 失败:`, error);
    }
  }
};

/**
 * 获取所有 IndexedDB 数据库信息
 */
export const getDatabaseInfo = async (): Promise<IDBDatabaseInfo[]> => {
  if ('databases' in indexedDB) {
    try {
      return await indexedDB.databases();
    } catch (error) {
      console.error('获取数据库信息失败:', error);
      return [];
    }
  }
  return [];
};

/**
 * 在控制台中显示数据库信息
 */
export const logDatabaseInfo = async (): Promise<void> => {
  const databases = await getDatabaseInfo();
  console.group('📊 IndexedDB 数据库信息');
  
  if (databases.length === 0) {
    console.log('没有找到 IndexedDB 数据库');
  } else {
    databases.forEach((db, index) => {
      console.log(`${index + 1}. ${db.name} (版本: ${db.version})`);
    });
  }
  
  console.groupEnd();
};

// 在开发环境中暴露到全局对象，方便调试
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as any).clearIndexedDB = {
    deleteDatabase,
    clearAllDatabases,
    getDatabaseInfo,
    logDatabaseInfo
  };
  
  console.log('🔧 IndexedDB 清理工具已加载到 window.clearIndexedDB');
  console.log('可用方法:');
  console.log('- clearIndexedDB.deleteDatabase(dbName)');
  console.log('- clearIndexedDB.clearAllDatabases()');
  console.log('- clearIndexedDB.getDatabaseInfo()');
  console.log('- clearIndexedDB.logDatabaseInfo()');
}
