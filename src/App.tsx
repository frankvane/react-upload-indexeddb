import ZustandFileDownload from "./components/ZustandFileDownload";
import ZustandFileUpload from "./components/ZustandFileUpload";

const App = () => {
  return (
    <div style={{ padding: 16 }}>
      <ZustandFileUpload />
      <ZustandFileDownload />
    </div>
  );
};
export default App;
