/**
 * IndexedDB cleanup helpers used in development.
 */

export const deleteDatabase = async (dbName: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const deleteRequest = indexedDB.deleteDatabase(dbName);

    deleteRequest.onsuccess = () => {
      console.log(`Database ${dbName} deleted successfully`);
      resolve();
    };

    deleteRequest.onerror = () => {
      console.error(`Failed to delete database ${dbName}:`, deleteRequest.error);
      reject(deleteRequest.error);
    };

    deleteRequest.onblocked = () => {
      console.warn(`Deletion for database ${dbName} is blocked by another tab`);
      setTimeout(() => {
        reject(new Error("Database deletion is blocked"));
      }, 5000);
    };
  });
};

export const clearAllDatabases = async (): Promise<void> => {
  const databasesToClear = ["fileDownloadTest", "fileUploadTest", "localforage"];

  for (const dbName of databasesToClear) {
    try {
      await deleteDatabase(dbName);
    } catch (error) {
      console.error(`Failed to clear database ${dbName}:`, error);
    }
  }
};

export const getDatabaseInfo = async (): Promise<IDBDatabaseInfo[]> => {
  if ("databases" in indexedDB) {
    try {
      return await indexedDB.databases();
    } catch (error) {
      console.error("Failed to get database info:", error);
      return [];
    }
  }

  return [];
};

export const logDatabaseInfo = async (): Promise<void> => {
  const databases = await getDatabaseInfo();
  console.group("IndexedDB database info");

  if (databases.length === 0) {
    console.log("No IndexedDB databases found");
  } else {
    databases.forEach((db, index) => {
      console.log(`${index + 1}. ${db.name} (version: ${db.version})`);
    });
  }

  console.groupEnd();
};

interface IndexedDBDebugTools {
  deleteDatabase: typeof deleteDatabase;
  clearAllDatabases: typeof clearAllDatabases;
  getDatabaseInfo: typeof getDatabaseInfo;
  logDatabaseInfo: typeof logDatabaseInfo;
}

if (typeof window !== "undefined" && import.meta.env.DEV) {
  const debugWindow = window as Window & { clearIndexedDB?: IndexedDBDebugTools };

  debugWindow.clearIndexedDB = {
    deleteDatabase,
    clearAllDatabases,
    getDatabaseInfo,
    logDatabaseInfo,
  };

  console.log("IndexedDB debug tools loaded at window.clearIndexedDB");
  console.log("Available methods:");
  console.log("- clearIndexedDB.deleteDatabase(dbName)");
  console.log("- clearIndexedDB.clearAllDatabases()");
  console.log("- clearIndexedDB.getDatabaseInfo()");
  console.log("- clearIndexedDB.logDatabaseInfo()");
}
