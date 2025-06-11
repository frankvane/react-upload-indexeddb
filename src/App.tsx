import ZustandFileDownload from "./components/ZustandFileDownload";
import ZustandFileUpload from "./components/ZustandFileUpload";

const App = () => {
  return (
    <div style={{ padding: 16 }}>
      <ZustandFileUpload />
      <ZustandFileDownload
        baseURL="http://localhost:3000"
        listApi="/api/files/list"
        downloadApi="/api/files/download"
      />
    </div>
  );
};
export default App;
